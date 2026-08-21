/**
 * encodeWav.ts — 把前端录制音频统一编码为 ASR 最稳的 WAV(16kHz·单声道·16bit PCM)。
 *
 * 背景：浏览器 MediaRecorder 产出的是 WebM/Opus 或 MP4/AAC 容器，豆包 ASR 对其
 * 兼容性不稳定（曾出现 code: 11103 audio convert failed，且与容器头缺失叠加更易触发）。
 * 统一转成 WAV 可彻底规避容器差异；同时在此完成降采样 / 混单声道 / 时长度量，
 * 供上层做「过短不识别」与「超长断句」等质量控制。
 */

const TARGET_SAMPLE_RATE = 16000;

export interface EncodedWav {
  /** 纯 base64（不含 data URI 前缀，后端 handleASR 已兼容带前缀的情况） */
  base64: string;
  /** 解码后的实际时长（秒），用于下限/上限判断 */
  seconds: number;
}

/** 把任意浏览器可解码的音频 blob 转码为 WAV 并返回 base64；解码失败时 reject */
export async function encodeAudioToBase64Wav(blob: Blob): Promise<EncodedWav> {
  const arrayBuf = await blob.arrayBuffer();
  if (!arrayBuf.byteLength) throw new Error('empty audio');

  // 用 OfflineAudioContext 解码，避免创建真实 AudioContext（受限环境/移动端更稳）
  const decodeCtx = new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE);
  const audioBuffer = await decodeCtx.decodeAudioData(arrayBuf);
  const seconds = audioBuffer.duration || 0;

  // 第二次 OfflineAudioContext 渲染：source buffer 会被自动重采样到 16000，且输出为
  // 单声道（OfflineAudioContext 渲染将多声道混音为单声道），一举完成 降采样 + 混单声道
  const frameCount = Math.max(128, Math.ceil(seconds * TARGET_SAMPLE_RATE));
  const resampleCtx = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
  const src = resampleCtx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(resampleCtx.destination);
  src.start(0);
  const rendered = await resampleCtx.startRendering();
  const input = rendered.getChannelData(0); // Float32，单声道

  const pcm = floatTo16BitPcm(input);
  const wav = buildWav(pcm, TARGET_SAMPLE_RATE);
  return { base64: arrayBufferToBase64(wav), seconds };
}

function floatTo16BitPcm(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** 组装标准 PCM WAV 头（44 字节）+ 数据区 */
function buildWav(pcm: Int16Array, sampleRate: number): ArrayBuffer {
  const dataSize = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF'); // ChunkID
  view.setUint32(4, 36 + dataSize, true); // ChunkSize
  writeStr(8, 'WAVE'); // Format
  writeStr(12, 'fmt '); // Subchunk1ID
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat = PCM
  view.setUint16(22, 1, true); // NumChannels = 1 (单声道)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate = SR * 1ch * 2bytes
  view.setUint16(32, 2, true); // BlockAlign = 2
  view.setUint16(34, 16, true); // BitsPerSample = 16
  writeStr(36, 'data'); // Subchunk2ID
  view.setUint32(40, dataSize, true); // Subchunk2Size

  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return buffer;
}

/** 分批转 base64，避免超长字符串构造导致栈溢出（16k·单声道·16bit 约 32KB/s） */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}