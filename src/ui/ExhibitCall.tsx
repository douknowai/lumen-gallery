/**
 * ExhibitCall.tsx — 展品「AI 语音讲解 / 打电话式对话」。
 *
 * 从「打开即弹窗」升级为「边走动边对话」的通话体验：
 * - 通话对象锁定在某个展品（callExhibitId），折叠后仍保留；
 * - 底部「字幕条」以影视字幕形式展示 AI 播报与用户转录（始终可见、不挡路）；
 * - 支持折叠 / 展开，折叠时回到展厅自由走动（字幕 + 悬浮控制条继续工作）；
 * - 两种输入模式：按住说话（空格键 / 屏幕按钮）与免提自动断句（浏览器端 VAD 能量检测）；
 * - 音色由 store 的 voiceId 驱动，透传给 TTS。
 * - 组件挂载由 App.tsx 以 callExhibitId 作为 key 驱动，切换展品即自动重置状态。
 *
 * 说明：SDK 的 ASR 为「一次性识别」接口，不含流式/VAD，故「免提自动断句」在浏览器端
 * 用 Web Audio API 的 AnalyserNode 做能量检测（近似 VAD），停顿超阈值自动切分送识别。
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PhoneOff, Maximize2, Minimize2, AudioLines, Mic, Volume2 } from 'lucide-react';
import { useStore, selectCallExhibit } from '@/state/store';
import { narrate, asr, chatStream, ttsSegments, loadChatHistory, saveChatHistory, type AiExhibitBrief, type ChatMessage, type TtsSegment } from '@/lib/ai';
import { encodeAudioToBase64Wav } from '@/lib/encodeWav';
import { useI18n } from '@/lib/i18n';

interface Transcript {
  role: 'user' | 'assistant';
  content: string;
}

type Busy = 'narrate' | 'asr' | 'llm' | 'tts' | null;

let sharedAudio: HTMLAudioElement | null = null;
function getAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
  }
  return sharedAudio;
}

function pickMimeType(): string {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

/** ASR 质量控制的时长边界（单位：秒）。低于下限视为“没开口”，高于上限在免提长句中强制断句 */
const MIN_ASR_SECONDS = 0.3;
const MAX_VAD_SEGMENT_SECONDS = 20;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

interface VadRef {
  stream: MediaStream | null;
  audioCtx: AudioContext | null;
  analyser: AnalyserNode | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  sentenceStart: number;
  speechStartMs: number;
  speaking: boolean;
  silenceMs: number;
  baseline: number;
  threshold: number;
  calibrated: boolean;
  calibratedMs: number;
  timer: ReturnType<typeof setInterval> | null;
  data: Uint8Array<ArrayBuffer> | null;
}

function createVadRef(): VadRef {
  return {
    stream: null,
    audioCtx: null,
    analyser: null,
    recorder: null,
    chunks: [],
    sentenceStart: 0,
    speechStartMs: 0,
    speaking: false,
    silenceMs: 0,
    baseline: 0.02,
    threshold: 0.04,
    calibrated: false,
    calibratedMs: 0,
    timer: null,
    data: null,
  };
}

export default function ExhibitCall() {
  const exhibit = useStore(selectCallExhibit);
  const callCollapsed = useStore((s) => s.callCollapsed);
  const callMode = useStore((s) => s.callMode);
  const voiceId = useStore((s) => s.voiceId);
  const collapseCall = useStore((s) => s.collapseCall);
  const expandCall = useStore((s) => s.expandCall);
  const closeCall = useStore((s) => s.closeCall);
  
  const isMobile = useStore((s) => s.isMobile);
  const { lang, t } = useI18n();

  const [transcript, setTranscript] = useState<Transcript[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [recording, setRecording] = useState(false);
  const [vadActive, setVadActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const historyRef = useRef<ChatMessage[]>([]);
  const pressedRef = useRef(false);
  const aliveRef = useRef(true);
  const playingRef = useRef(false);
  const stopTokenRef = useRef(0);
  const inAsrRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const vadRef = useRef<VadRef>(createVadRef());

  const onSpeakStartRef = useRef<() => void>(() => {});
  const onSegmentEndRef = useRef<(blob: Blob) => void>(() => {});
  const pressStartRef = useRef<() => void>(() => {});
  const pressEndRef = useRef<() => void>(() => {});
  const toggleVadRef = useRef<() => void>(() => {});

  const isBusy = busy !== null;

  /* ---------- 基础资源控制 ---------- */
  const stopAudioInternal = useCallback(() => {
    stopTokenRef.current += 1;
    const a = sharedAudio;
    if (a) {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    playingRef.current = false;
  }, []);

  const disposeVadResources = useCallback(() => {
    const v = vadRef.current;
    if (v.timer) clearInterval(v.timer);
    v.timer = null;
    v.stream?.getTracks().forEach((t) => t.stop());
    const rec = v.recorder;
    // 先断开引用，onstop 的 guard 会判定「recorder 已被 dispose」而忽略残句，
    // 避免挂断/切模式时把最后一段误送识别
    vadRef.current = createVadRef();
    if (rec && rec.state !== 'inactive') rec.stop();
    void v.audioCtx?.close().catch(() => {});
  }, []);

  const disposePushResources = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.onstop = null;
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const stopEverything = useCallback(() => {
    disposeVadResources();
    disposePushResources();
    stopAudioInternal();
  }, [disposeVadResources, disposePushResources, stopAudioInternal]);

  const playAudio = useCallback((uri: string): Promise<void> => {
    return new Promise((resolve) => {
      const a = getAudio();
      playingRef.current = true;
      a.onended = () => {
        playingRef.current = false;
        resolve();
      };
      a.onerror = () => {
        playingRef.current = false;
        resolve();
      };
      a.src = uri;
      void a.play().catch(() => {
        playingRef.current = false;
        resolve();
      });
    });
  }, []);

  const playSegments = useCallback(
    async (segments: TtsSegment[]): Promise<void> => {
      const token = stopTokenRef.current;
      for (const seg of segments) {
        if (!aliveRef.current || token !== stopTokenRef.current) return;
        await playAudio(seg.audioUri);
      }
    },
    [playAudio],
  );

  const toBrief = useCallback(
    (): AiExhibitBrief => ({
      title: exhibit?.title ?? '这件作品',
      titleEn: exhibit?.titleEn,
      artist: exhibit?.artist,
      year: exhibit?.year,
      medium: exhibit?.medium,
      description: exhibit?.description ?? '',
      src: exhibit?.type === 'image' ? exhibit.src : undefined,
    }),
    [exhibit],
  );

  /* ---------- 用户一句话 → LLM 流式 → TTS ---------- */
  const handleUserMessage = useCallback(
    async (text: string) => {
      if (!aliveRef.current) return;
      stopAudioInternal();
      setTranscript((prev) => [...prev, { role: 'user', content: text }]);
      historyRef.current.push({ role: 'user', content: text });
      saveChatHistory(exhibit?.id ?? '', historyRef.current);

      setStreaming('');
      setBusy('llm');
      setError(null);

      let full = '';
      try {
        const history = historyRef.current.slice(0, -1).slice(-8);
        for await (const delta of chatStream(toBrief(), text, history)) {
          if (!aliveRef.current) return;
          full += delta;
          setStreaming(full);
        }
        if (!aliveRef.current) return;
        const finalText = full.trim() || '（我一时没想好怎么回应，换个问法试试？）';
        historyRef.current.push({ role: 'assistant', content: finalText });
        setTranscript((prev) => [...prev, { role: 'assistant', content: finalText }]);
        saveChatHistory(exhibit?.id ?? '', historyRef.current);
        setStreaming(null);

        setBusy('tts');
        const segments = await ttsSegments(finalText, voiceId);
        if (!aliveRef.current) return;
        await playSegments(segments);
      } catch (err) {
        if (!aliveRef.current) return;
        setStreaming(null);
        setError(err instanceof Error ? err.message : '对话失败，请重试');
      } finally {
        if (aliveRef.current) setBusy(null);
      }
    },
    [stopAudioInternal, playSegments, toBrief, voiceId, exhibit],
  );

  /* ---------- 一段音频 → ASR → 对话 ---------- */
  const processAudioBlob = useCallback(
    async (blob: Blob) => {
      if (blob.size < 200) {
        if (aliveRef.current) setError('没有录到声音，请靠近麦克风再试');
        return;
      }
      if (!aliveRef.current || inAsrRef.current) return;
      inAsrRef.current = true;
      setBusy('asr');
      setError(null);
      try {
        // 统一编码为 WAV(16kHz·单声道·16bit)，规避 WebM/Opus 容器的 ASR 兼容性问题
        let base64: string;
        try {
          const { base64: wavBase64, seconds } = await encodeAudioToBase64Wav(blob);
          if (seconds < MIN_ASR_SECONDS) {
            if (aliveRef.current) setError('太短没听清，请靠近麦克风再说一次');
            return;
          }
          base64 = wavBase64;
        } catch {
          // 解码失败为极罕见情况，回退到原始容器 base64，交由后端尽力处理
          base64 = await blobToBase64(blob);
        }
        const { text } = await asr(base64);
        if (!aliveRef.current) return;
        if (!text?.trim()) {
          setError('没听清，请再说一次');
          return;
        }
        await handleUserMessage(text.trim());
      } catch (err) {
        if (aliveRef.current) setError(err instanceof Error ? err.message : '语音识别失败');
      } finally {
        inAsrRef.current = false;
        if (aliveRef.current) setBusy(null);
      }
    },
    [handleUserMessage],
  );

  /* ---------- 按住说话（push 模式） ---------- */
  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') recorder.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    if (aliveRef.current) setRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('当前浏览器不支持录音，请使用最新版 Chrome / Safari');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!aliveRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        void processAudioBlob(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      if (!pressedRef.current) stopRecording();
    } catch {
      if (aliveRef.current) setError('无法访问麦克风，请在浏览器中允许麦克风权限');
    }
  }, [processAudioBlob, stopRecording]);

  const handlePressStart = useCallback(() => {
    if (isBusy) return;
    stopAudioInternal();
    pressedRef.current = true;
    void startRecording();
  }, [isBusy, startRecording, stopAudioInternal]);

  const handlePressEnd = useCallback(() => {
    pressedRef.current = false;
    if (mediaRecorderRef.current?.state === 'recording') stopRecording();
  }, [stopRecording]);

  /* ---------- 免提自动断句（VAD 模式） ---------- */
  const handleVadSpeakStart = useCallback(() => {
    stopAudioInternal();
    if (aliveRef.current) setRecording(true);
  }, [stopAudioInternal]);

  // VAD 检测循环（setInterval 触发，只读 refs 与最新回调，不依赖组件状态）
  const detectVad = useCallback(() => {
    const v = vadRef.current;
    if (!v.analyser || !v.data) return;
    v.analyser.getByteTimeDomainData(v.data);

    let sum = 0;
    for (let i = 0; i < v.data.length; i++) {
      const x = (v.data[i] - 128) / 128;
      sum += x * x;
    }
    const rms = Math.sqrt(sum / v.data.length);

    if (!v.calibrated) {
      v.calibratedMs += 80;
      v.baseline = Math.max(0.01, v.baseline * 0.92 + rms * 0.08);
      if (v.calibratedMs >= 600) {
        v.calibrated = true;
        v.threshold = Math.max(0.045, v.baseline * 3);
      }
      return;
    }

    if (playingRef.current) {
      v.speaking = false;
      v.silenceMs = 0;
      return;
    }

    if (!v.speaking && rms > v.threshold) {
      // 开口：开始录制本句。MediaRecorder 每次 start→stop 都会产出
      // 「含完整容器头」的独立片段，避免切片缺头导致后端 audio convert failed
      v.speaking = true;
      v.silenceMs = 0;
      v.speechStartMs = Date.now();
      v.chunks.length = 0;
      onSpeakStartRef.current();
      const rec = v.recorder;
      if (rec && rec.state === 'inactive') {
        try {
          rec.start(250);
        } catch {
          /* 忽略：下次开口再试 */
        }
      }
    } else if (v.speaking) {
      // 超长强制断句：防止单句无停顿一直录下去，控制单次 ASR 负载
      const over = Date.now() - v.speechStartMs >= MAX_VAD_SEGMENT_SECONDS * 1000;
      if (over) {
        if (inAsrRef.current) {
          // 上一条仍在识别，若此时断句会丢失内容：顺延计时，等空闲再切
          v.speechStartMs = Date.now();
          v.silenceMs = 0;
          return;
        }
        v.speaking = false;
        v.silenceMs = 0;
        if (aliveRef.current) setRecording(false);
        const rec = v.recorder;
        if (rec && rec.state === 'recording') {
          try {
            rec.stop();
          } catch {
            /* 忽略 */
          }
        }
        return;
      }
      if (rms < v.threshold * 0.7) {
        v.silenceMs += 80;
        if (v.silenceMs >= 1200 && v.chunks.length > 0) {
          // 断句：停止录制 → onstop 异步产出完整片段并送识别
          v.speaking = false;
          v.silenceMs = 0;
          if (aliveRef.current) setRecording(false);
          const rec = v.recorder;
          if (rec && rec.state === 'recording') {
            try {
              rec.stop();
            } catch {
              /* 忽略 */
            }
          }
        }
      } else {
        v.silenceMs = 0;
      }
    }
  }, []);

  const startVad = useCallback(async () => {
    const v = vadRef.current;
    if (v.stream || v.timer) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('当前浏览器不支持录音，请使用最新版 Chrome / Safari');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!aliveRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const Ctx: typeof AudioContext =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new Ctx();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);

      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        // 仅当 recorder 仍挂载在当前 VAD 会话中才识别，避免挂断/切模式时识别残句
        if (vadRef.current.recorder !== recorder) return;
        const seg = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        chunks.length = 0;
        if (aliveRef.current) onSegmentEndRef.current(seg);
      };
      // 注意：这里不在启动时就 start()。由 VAD 检测到开口才 start、断句时 stop，
      // 保证每个片段的 chunks 都从第一个数据块（含容器头）开始，是独立完整可解码文件

      vadRef.current = {
        ...createVadRef(),
        stream,
        audioCtx,
        analyser,
        recorder,
        chunks,
        data: new Uint8Array(analyser.fftSize),
        timer: setInterval(() => detectVad(), 80),
      };
      if (aliveRef.current) setVadActive(true);
    } catch {
      if (aliveRef.current) setError('无法访问麦克风，请在浏览器中允许麦克风权限');
    }
  }, [detectVad]);

  const stopVad = useCallback(() => {
    disposeVadResources();
    if (aliveRef.current) {
      setRecording(false);
      setVadActive(false);
    }
  }, [disposeVadResources]);

  const handleVadSegment = useCallback(
    async (blob: Blob) => {
      await processAudioBlob(blob);
    },
    [processAudioBlob],
  );

  /* ---------- 免提开/关 ---------- */
  const toggleVad = useCallback(() => {
    if (vadRef.current.stream || vadRef.current.timer) {
      stopVad();
    } else {
      void startVad();
    }
  }, [startVad, stopVad]);

  /* ---------- 听介绍 ---------- */
  const handleNarrate = useCallback(async () => {
    if (isBusy || !exhibit) return;
    stopAudioInternal();
    setBusy('narrate');
    setError(null);
    try {
      const { text } = await narrate(toBrief(), voiceId);
      if (!aliveRef.current) return;
      setTranscript((prev) => [...prev, { role: 'assistant', content: text }]);
      historyRef.current.push({ role: 'assistant', content: text });
      saveChatHistory(exhibit?.id ?? '', historyRef.current);
      setBusy('tts');
      const segments = await ttsSegments(text, voiceId);
      if (!aliveRef.current) return;
      await playSegments(segments);
    } catch (err) {
      if (aliveRef.current) setError(err instanceof Error ? err.message : '讲解生成失败，请重试');
    } finally {
      if (aliveRef.current) setBusy(null);
    }
  }, [isBusy, exhibit, stopAudioInternal, playSegments, toBrief, voiceId]);

  /* ---------- 挂断 / 折叠 ---------- */
  const handleEndCall = useCallback(() => {
    disposeVadResources();
    disposePushResources();
    stopAudioInternal();
    closeCall();
  }, [disposeVadResources, disposePushResources, stopAudioInternal, closeCall]);

  const handleCollapse = useCallback(() => {
    collapseCall();
  }, [collapseCall]);

  /* ---------- 挂载：载入该展品历史对话 ---------- */
  useEffect(() => {
    if (!exhibit?.id) return;
    const saved = loadChatHistory(exhibit.id);
    if (saved.length) {
      historyRef.current = saved;
      setTranscript(saved.map((m) => ({ role: m.role, content: m.content })));
    }
  }, [exhibit?.id]);

  /* ---------- 挂载：重置存活标记；卸载清理（免提改为手动开启，不再自动监听） ---------- */
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopEverything();
    };
  }, [stopEverything]);

  /* ---------- 每轮渲染更新最新回调（供 VAD 循环 / 空格监听读取） ---------- */
  useEffect(() => {
    onSpeakStartRef.current = handleVadSpeakStart;
    onSegmentEndRef.current = handleVadSegment;
    pressStartRef.current = handlePressStart;
    pressEndRef.current = handlePressEnd;
    toggleVadRef.current = toggleVad;
  });

  /* ---------- 空格键按住说话 ---------- */
  useEffect(() => {
    const down = (ev: KeyboardEvent) => {
      if (ev.code !== 'Space') return;
      const st = useStore.getState();
      if (!st.callExhibitId) return;
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      ev.preventDefault();
      if (ev.repeat) return;
      if (st.callMode === 'push') {
        pressStartRef.current();
      } else {
        toggleVadRef.current();
      }
    };
    const up = (ev: KeyboardEvent) => {
      if (ev.code !== 'Space') return;
      const st = useStore.getState();
      if (!st.callExhibitId || st.callMode !== 'push') return;
      ev.preventDefault();
      pressEndRef.current();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  if (!exhibit) return null;

  /* ---------- 字幕内容推导 ---------- */
  const lastAssistant = [...transcript].reverse().find((t) => t.role === 'assistant')?.content;
  const lastUser = [...transcript].reverse().find((t) => t.role === 'user')?.content;

  const assistantLine =
    recording || busy === 'asr'
      ? recording
        ? t('call.listening')
        : t('call.recognizing')
      : busy === 'narrate'
        ? t('call.writing')
        : busy === 'llm'
          ? (streaming ?? '…')
          : busy === 'tts'
            ? (lastAssistant ?? '')
            : (lastAssistant ?? (callMode === 'vad' ? (vadActive ? t('call.vadOnHint') : t('call.vadOffHint')) : t('call.pushHint')));

  const statusText = recording
    ? t('call.listening')
    : busy === 'narrate'
      ? t('call.writing')
      : busy === 'asr'
        ? t('call.recognizing')
        : busy === 'llm'
          ? t('call.thinking')
          : busy === 'tts'
            ? t('call.speaking')
            : callMode === 'vad'
              ? (vadActive ? t('call.vadOnHint') : t('call.vadOffHint'))
              : t('call.pushMode');

  return (
    <>
      {/* 底部字幕条（影视字幕风格，始终显示、不挡导航） */}
      <motion.div
        key="subtitle"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] z-[60] flex flex-col items-center gap-1.5 px-6"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {lastUser && busy !== 'asr' && !recording && (
          <div
            className="max-w-[min(680px,92vw)] rounded-full px-3.5 py-1 text-[12.5px]"
            style={{ background: 'rgba(20,18,15,.55)', color: 'rgba(244,241,234,.8)' }}
          >
            {t('call.you')}：{lastUser}
          </div>
        )}
        <div
          className="max-w-[min(760px,94vw)] whitespace-pre-wrap rounded-xl px-5 py-2.5 text-center text-[15px] leading-relaxed"
          style={{
            background: 'rgba(20,18,15,.72)',
            color: 'var(--paper)',
            boxShadow: '0 8px 28px -12px rgba(20,18,15,.6)',
            textShadow: '0 1px 2px rgba(0,0,0,.35)',
            border: '1px solid rgba(166,124,61,.28)',
            backdropFilter: 'blur(6px)',
          }}
        >
          {assistantLine}
          {busy === 'llm' && <span className="ml-0.5 inline-block animate-pulse" style={{ color: 'var(--brass)' }}>▍</span>}
        </div>
      </motion.div>

      {/* 折叠态：悬浮控制胶囊 */}
      <AnimatePresence>
        {callCollapsed && (
          <motion.div
            key="collapsed-bar"
            className={`fixed inset-x-0 z-[60] flex justify-center px-4 ${isMobile ? 'top-[calc(env(safe-area-inset-top)+4rem)]' : 'top-4'}`}
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.25 }}
          >
            <div
              className="pointer-events-auto flex items-center gap-1.5 rounded-full border px-2 py-2"
              style={{ background: 'rgba(250,247,240,.92)', borderColor: 'var(--line)', boxShadow: '0 12px 32px -14px rgba(20,18,15,.5)', backdropFilter: 'blur(8px)' }}
            >
              {callMode === 'push' ? (
                <motion.button
                  type="button"
                  onPointerDown={handlePressStart}
                  onPointerUp={handlePressEnd}
                  onPointerCancel={handlePressEnd}
                  onPointerLeave={handlePressEnd}
                  onContextMenu={(e) => e.preventDefault()}
                  whileTap={{ scale: 0.9 }}
                  disabled={isBusy && !recording}
                  className="flex h-11 w-11 select-none items-center justify-center rounded-full disabled:opacity-50"
                  style={{ touchAction: 'none', background: recording ? '#a63d2f' : 'var(--brass)', color: 'var(--paper)' }}
                  aria-label={t('call.pressToTalk')}
                >
                  <Mic size={20} strokeWidth={1.5} />
                </motion.button>
              ) : (
                <button
                  type="button"
                  onClick={toggleVad}
                  className="flex h-11 w-11 items-center justify-center rounded-full transition-transform active:scale-95"
                  style={{ background: vadActive ? 'var(--brass)' : 'var(--paper-dim)', color: recording ? '#a63d2f' : vadActive ? 'var(--paper)' : 'var(--stone)' }}
                  title={vadActive ? t('call.toggleVadOff') : t('call.toggleVadOn')}
                  aria-label={vadActive ? t('call.toggleVadOff') : t('call.toggleVadOn')}
                >
                  <span className="relative">
                    <AudioLines size={20} strokeWidth={1.5} />
                    {vadActive && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full" style={{ background: recording ? '#a63d2f' : 'var(--paper)' }} />}
                  </span>
                </button>
              )}

              <div className="mx-0.5 h-6 w-px" style={{ background: 'var(--line)' }} />

              <button
                type="button"
                onClick={expandCall}
                className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--paper-dim)]"
                title={t('call.expand')}
                aria-label={t('call.expand')}
              >
                <Maximize2 size={18} strokeWidth={1.5} style={{ color: 'var(--ink)' }} />
              </button>

              <button
                type="button"
                onClick={handleEndCall}
                className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[#f6e3df]"
                title={t('call.hangup')}
                aria-label={t('call.hangup')}
              >
                <PhoneOff size={18} strokeWidth={1.5} style={{ color: '#a63d2f' }} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 展开态：通话面板（叠加在展品详情之上） */}
      <AnimatePresence>
        {!callCollapsed && (
          <motion.div
            key="call-panel"
            className="fixed inset-0 z-[55] flex items-end justify-center bg-[rgba(20,18,15,.35)] sm:items-center sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCollapse}
          >
            <motion.div
              className="flex w-full flex-col overflow-hidden sm:max-w-md"
              style={{
                background: 'var(--paper)',
                height: isMobile ? '72vh' : 'min(540px, 84vh)',
                borderRadius: isMobile ? '20px 20px 0 0' : '18px',
                boxShadow: '0 24px 80px -20px rgba(20,18,15,.5)',
                border: '1px solid var(--line)',
              }}
              initial={isMobile ? { y: '100%' } : { y: 24, scale: 0.98 }}
              animate={isMobile ? { y: 0 } : { y: 0, scale: 1 }}
              exit={isMobile ? { y: '100%' } : { y: 24, scale: 0.98, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
              onClick={(ev) => ev.stopPropagation()}
            >
              {/* 头部 */}
              <div className="flex shrink-0 items-center gap-3 px-5 py-3.5" style={{ borderBottom: '1px solid var(--line)' }}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--brass)', color: 'var(--paper)' }}>
                  <AudioLines size={20} strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-serif-lumen text-[15px] font-medium" style={{ color: 'var(--ink)' }}>
                    {lang === 'zh' ? `与「${exhibit.title}」语音对话` : `Talking with "${exhibit.titleEn || exhibit.title}"`}
                  </div>
                  <div className="mt-0.5 font-mono-lumen text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--stone)' }}>
                    {exhibit.artist || (lang === 'zh' ? 'AI 讲解' : 'AI Guide')}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={t('call.collapse')}
                  onClick={handleCollapse}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--paper-dim)]"
                  title={t('call.collapse')}
                >
                  <Minimize2 size={18} strokeWidth={1.5} style={{ color: 'var(--ink)' }} />
                </button>
                <button
                  type="button"
                  aria-label={t('call.hangup')}
                  onClick={handleEndCall}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[#f6e3df]"
                >
                  <PhoneOff size={18} strokeWidth={1.5} style={{ color: '#a63d2f' }} />
                </button>
              </div>

              {/* 消息区 */}
              <div ref={scrollRef} className="lumen-scroll flex-1 overflow-y-auto px-4 py-4">
                {error && (
                  <div className="mb-2 rounded-xl px-3.5 py-2.5 text-[13px]" style={{ background: '#f6e3df', color: '#a63d2f' }}>
                    {error}
                  </div>
                )}

                {transcript.length === 0 && streaming === null ? (
                  <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: 'var(--paper-dim)', color: 'var(--brass)' }}>
                      <AudioLines size={24} strokeWidth={1.5} />
                    </div>
                    <div>
                      <p className="font-serif-lumen text-[16px]" style={{ color: 'var(--ink)' }}>{lang === 'zh' ? '想先听听它的故事吗？' : 'Want to hear its story first?'}</p>
                      <p className="mt-1 max-w-[260px] text-[13px] leading-relaxed" style={{ color: 'var(--stone)' }}>
                        {lang === 'zh' ? `点下方按钮，让「${exhibit.title}」以第一人称自我介绍。` : `Tap below and let "${exhibit.titleEn || exhibit.title}" introduce itself in the first person.`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleNarrate}
                      disabled={isBusy}
                      className="flex items-center gap-2 rounded-full px-5 py-2.5 disabled:opacity-50"
                      style={{ background: 'var(--brass)', color: 'var(--paper)', boxShadow: '0 10px 24px -10px rgba(166,124,61,.6)' }}
                    >
                      <Volume2 size={18} strokeWidth={1.5} />
                      <span className="font-serif-lumen text-[14px]">{t('exhibit.listen')}</span>
                    </button>
                    <p className="text-[12px]" style={{ color: 'var(--stone)' }}>
                      也可以 {callMode === 'vad' ? '开启下方免提后直接开口' : '按住下方麦克风说话'}，向它提问
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex justify-center">
                      <button
                        type="button"
                        onClick={handleNarrate}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono-lumen text-[11px] uppercase tracking-[0.08em] transition-colors hover:bg-[var(--paper-dim)] disabled:opacity-50"
                        style={{ borderColor: 'var(--line)', color: 'var(--stone)' }}
                      >
                        <Volume2 size={13} strokeWidth={1.5} />
                        再听一遍介绍
                      </button>
                    </div>

                    {transcript.map((t, i) => {
                      const isUser = t.role === 'user';
                      return (
                        <div key={i} className={`mb-2.5 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className="max-w-[82%] whitespace-pre-wrap rounded-[14px] px-3.5 py-2.5 text-[13.5px] leading-relaxed"
                            style={
                              isUser
                                ? { background: 'var(--brass)', color: 'var(--paper)', borderBottomRightRadius: '4px' }
                                : { background: 'var(--paper-dim)', color: 'var(--ink)', borderBottomLeftRadius: '4px', border: '1px solid var(--line)' }
                            }
                          >
                            {t.content}
                          </div>
                        </div>
                      );
                    })}

                    {streaming !== null && (
                      <div className="mb-2.5 flex justify-start">
                        <div
                          className="max-w-[82%] whitespace-pre-wrap rounded-[14px] px-3.5 py-2.5 text-[13.5px] leading-relaxed"
                          style={{ background: 'var(--paper-dim)', color: 'var(--ink)', borderBottomLeftRadius: '4px', border: '1px solid var(--line)' }}
                        >
                          {streaming}
                          <span className="ml-0.5 inline-block animate-pulse" style={{ color: 'var(--brass)' }}>▍</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 底部控制区：唯一主按钮（说话），输入方式已在设置面板选择 */}
              <div className="shrink-0 px-4 pb-3 pt-1" style={{ borderTop: '1px solid var(--line)' }}>
                <div className="mb-2 flex items-center justify-center gap-1.5 font-mono-lumen text-[10.5px] uppercase tracking-[0.1em]" style={{ color: 'var(--stone)' }}>
                  <span className={`h-1.5 w-1.5 rounded-full ${recording || vadActive ? 'animate-pulse' : ''}`} style={{ background: recording ? '#a63d2f' : 'var(--brass)' }} />
                  {statusText}
                </div>

                <div className="flex flex-col items-center gap-2">
                  {callMode === 'push' ? (
                    <motion.button
                      type="button"
                      onPointerDown={handlePressStart}
                      onPointerUp={handlePressEnd}
                      onPointerCancel={handlePressEnd}
                      onPointerLeave={handlePressEnd}
                      onContextMenu={(e) => e.preventDefault()}
                      whileTap={{ scale: 0.92 }}
                      disabled={isBusy && !recording}
                      className="flex h-16 w-16 select-none items-center justify-center rounded-full disabled:opacity-50"
                      style={{
                        touchAction: 'none',
                        background: recording ? '#a63d2f' : 'var(--brass)',
                        color: 'var(--paper)',
                        boxShadow: recording ? '0 0 0 6px rgba(166,61,47,.18)' : '0 10px 24px -10px rgba(166,124,61,.6)',
                      }}
                      aria-label="按住说话（空格）"
                    >
                      <Mic size={26} strokeWidth={1.5} />
                    </motion.button>
                  ) : (
                    <button
                      type="button"
                      onClick={toggleVad}
                      className="flex h-16 w-16 items-center justify-center rounded-full transition-transform active:scale-95"
                      style={{
                        background: vadActive ? (recording ? '#a63d2f' : 'var(--brass)') : 'var(--paper-dim)',
                        color: vadActive ? 'var(--paper)' : 'var(--stone)',
                        boxShadow: vadActive ? '0 0 0 6px rgba(166,124,61,.18)' : 'none',
                      }}
                      aria-label={vadActive ? '关闭免提' : '开启免提'}
                      title={vadActive ? '免提聆听中，点击关闭' : '空格/点击开启免提自动聆听'}
                    >
                      <span className="relative">
                        <AudioLines size={26} strokeWidth={1.5} />
                        {vadActive && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full" style={{ background: recording ? '#a63d2f' : 'var(--paper)' }} />}
                      </span>
                    </button>
                  )}

                  <span className="font-mono-lumen text-[10.5px]" style={{ color: 'var(--stone)' }}>
                    {callMode === 'push' ? '按住说话 · 桌面可用空格键' : vadActive ? '免提聆听中 · 点击停止' : '空格/点击开启免提自动聆听'}
                  </span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}