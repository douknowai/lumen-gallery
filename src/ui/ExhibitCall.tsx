/**
 * ExhibitCall.tsx — 展品「AI 语音讲解 / 打电话式对话」面板（z 55，叠加在展品弹窗之上）。
 *
 * 交互闭环：按住说话（MediaRecorder 录音）→ ASR 转文本 → LLM 流式回复 → TTS 合成播放；
 * 另提供「听介绍」：LLM 生成第一人称口播稿 → TTS 播报。
 *
 * 约束：
 * - 录音走 navigator.mediaDevices.getUserMedia（麦克风权限），遵循卸载清理 track 的 WebRTC 规范；
 * - 音频播放使用模块级单例 Audio，避免面板卸载时 DOM 音频被销毁；
 * - 所有异步回调前用 aliveRef 守卫，防止卸载后 setState。
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AudioLines, Mic } from 'lucide-react';
import { useStore, selectModalExhibit, type Store } from '@/state/store';
import { narrate, asr, tts, chatStream, type AiExhibitBrief, type ChatMessage } from '@/lib/ai';

interface Transcript {
  role: 'user' | 'assistant';
  content: string;
}

type Busy = 'narrate' | 'asr' | 'llm' | 'tts' | null;

/** 模块级单例音频：跨 React 生命周期复用，避免卸载时丢音频 */
let sharedAudio: HTMLAudioElement | null = null;
function getAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
  }
  return sharedAudio;
}

/** 取麦克风支持的 mimeType（优先 m4a / webm opus） */
function pickMimeType(): string {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export default function ExhibitCall() {
  const exhibit = useStore(selectModalExhibit);
  const callOpen = useStore((s: Store) => s.callOpen);
  const closeCall = useStore((s: Store) => s.closeCall);
  const isMobile = useStore((s: Store) => s.isMobile);

  const [transcript, setTranscript] = useState<Transcript[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const historyRef = useRef<ChatMessage[]>([]);
  const pressedRef = useRef(false);
  const aliveRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const isBusy = busy !== null;

  /* 卸载 / 关闭时清理麦克风与音频 */
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      sharedAudio?.pause();
    };
  }, []);

  /* 消息更新时自动滚动到底部 */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript, streaming, recording]);

  const toBrief = useCallback(
    (): AiExhibitBrief => ({
      title: exhibit?.title ?? '这件作品',
      titleEn: exhibit?.titleEn,
      artist: exhibit?.artist,
      year: exhibit?.year,
      medium: exhibit?.medium,
      description: exhibit?.description ?? '',
    }),
    [exhibit],
  );

  const stopAudio = useCallback(() => {
    const a = sharedAudio;
    if (a) {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
  }, []);

  const playAudio = useCallback((uri: string): Promise<void> => {
    return new Promise((resolve) => {
      const a = getAudio();
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.src = uri;
      void a.play().catch(() => resolve());
    });
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') recorder.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (!aliveRef.current) return;
    setRecording(false);
  }, []);

  const handleUserMessage = useCallback(
    async (text: string) => {
      if (!aliveRef.current) return;
      stopAudio();
      setTranscript((prev) => [...prev, { role: 'user', content: text }]);
      historyRef.current.push({ role: 'user', content: text });

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
        setStreaming(null);

        setBusy('tts');
        const { audioUri } = await tts(finalText);
        if (!aliveRef.current) return;
        await playAudio(audioUri);
      } catch (err) {
        if (!aliveRef.current) return;
        setStreaming(null);
        setError(err instanceof Error ? err.message : '对话失败，请重试');
      } finally {
        if (aliveRef.current) setBusy(null);
      }
    },
    [stopAudio, playAudio, toBrief],
  );

  const handleRecorderStop = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    const type = recorder.mimeType || 'audio/webm';
    const blob = new Blob(chunksRef.current, { type });
    chunksRef.current = [];
    if (blob.size < 200) {
      if (aliveRef.current) setError('没有录到声音，请靠近麦克风再试');
      return;
    }
    if (!aliveRef.current) return;
    setBusy('asr');
    setError(null);
    try {
      const base64 = await blobToBase64(blob);
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
      if (aliveRef.current) setBusy(null);
    }
  }, [handleUserMessage]);

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
        void handleRecorderStop();
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      // 若用户已松手（极短点击），立即停止
      if (!pressedRef.current) stopRecording();
    } catch {
      if (aliveRef.current) setError('无法访问麦克风，请在浏览器中允许麦克风权限');
    }
  }, [handleRecorderStop, stopRecording]);

  const handlePressStart = useCallback(() => {
    if (isBusy) return;
    stopAudio();
    pressedRef.current = true;
    void startRecording();
  }, [isBusy, startRecording, stopAudio]);

  const handlePressEnd = useCallback(() => {
    pressedRef.current = false;
    if (mediaRecorderRef.current?.state === 'recording') stopRecording();
  }, [stopRecording]);

  const handleNarrate = useCallback(async () => {
    if (isBusy || !exhibit) return;
    stopAudio();
    setBusy('narrate');
    setError(null);
    try {
      const { text, audioUri } = await narrate(toBrief());
      if (!aliveRef.current) return;
      setTranscript((prev) => [...prev, { role: 'assistant', content: text }]);
      historyRef.current.push({ role: 'assistant', content: text });
      await playAudio(audioUri);
    } catch (err) {
      if (aliveRef.current) setError(err instanceof Error ? err.message : '讲解生成失败，请重试');
    } finally {
      if (aliveRef.current) setBusy(null);
    }
  }, [isBusy, exhibit, stopAudio, playAudio, toBrief]);

  const handleClose = useCallback(() => {
    stopRecording();
    stopAudio();
    setTranscript([]);
    setStreaming(null);
    setError(null);
    setBusy(null);
    historyRef.current = [];
    closeCall();
  }, [closeCall, stopRecording, stopAudio]);

  if (!exhibit || !callOpen) return null;

  const statusText = recording
    ? '正在聆听… 松开结束'
    : busy === 'narrate'
      ? '正在撰写讲解词…'
      : busy === 'asr'
        ? '正在识别语音…'
        : busy === 'llm'
          ? '正在思考…'
          : busy === 'tts'
            ? '正在播报…'
            : '按住下方按钮说话，或点「听介绍」';

  return (
    <AnimatePresence>
      <motion.div
        key="call"
        className="fixed inset-0 z-[55] flex items-end justify-center sm:items-center sm:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{ background: 'rgba(20,18,15,.5)' }}
        onClick={() => !recording && handleClose()}
      >
        <motion.div
          className="flex w-full flex-col overflow-hidden sm:max-w-md"
          style={{
            background: 'var(--paper)',
            height: isMobile ? '78vh' : 'min(560px, 84vh)',
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
          {/* 头部：展品头像 + 标题 + 关闭 */}
          <div
            className="flex shrink-0 items-center gap-3 px-5 py-4"
            style={{ borderBottom: '1px solid var(--line)' }}
          >
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
              style={{ background: 'var(--brass)', color: 'var(--paper)' }}
            >
              <AudioLines size={22} strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-serif-lumen text-[16px] font-medium" style={{ color: 'var(--ink)' }}>
                与「{exhibit.title}」语音对话
              </div>
              <div className="mt-0.5 font-mono-lumen text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--stone)' }}>
                {exhibit.artist || 'AI 讲解'} · 语音导览
              </div>
            </div>
            <button
              type="button"
              aria-label="结束通话"
              onClick={handleClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--paper-dim)]"
            >
              <X size={18} strokeWidth={1.5} style={{ color: 'var(--ink)' }} />
            </button>
          </div>

          {/* 消息区 */}
          <div ref={scrollRef} className="lumen-scroll flex-1 overflow-y-auto px-4 py-4">
            {transcript.length === 0 && streaming === null && !error && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div
                  className="flex h-14 w-14 items-center justify-center rounded-full"
                  style={{ background: 'var(--brass-wash)', color: 'var(--brass)' }}
                >
                  <Mic size={24} strokeWidth={1.5} />
                </div>
                <p className="max-w-[240px] text-[13px] leading-relaxed" style={{ color: 'var(--stone)' }}>
                  这件展品想跟你聊聊它的故事。点「听介绍」让它自我介绍，或按住说话向它提问。
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {transcript.map((item, i) => (
                <Bubble key={`${i}-${item.role}`} role={item.role} content={item.content} />
              ))}

              {/* 正在流式生成中的 assistant 气泡 */}
              {streaming !== null && (
                <div className="flex items-end gap-2">
                  <span className="text-[13px]" style={{ color: 'var(--brass)' }}>
                    ▍
                  </span>
                  <Bubble role="assistant" content={streaming || '…'} live />
                </div>
              )}

              {/* 录音中占位 */}
              {recording && (
                <div className="flex justify-end">
                  <div
                    className="flex items-center gap-2 rounded-2xl rounded-br-sm px-4 py-2.5 text-[14px]"
                    style={{ background: 'var(--brass)', color: 'var(--paper)' }}
                  >
                    <span className="inline-flex h-2 w-2 animate-pulse rounded-full" style={{ background: 'var(--paper)' }} />
                    正在聆听…
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="mt-3 rounded-xl border px-3 py-2 text-[13px]" style={{ borderColor: '#d8b4a8', color: '#a63d2f', background: '#faf1ee' }}>
                {error}
              </div>
            )}
          </div>

          {/* 底部操作区 */}
          <div
            className="shrink-0 px-5 pb-5 pt-3"
            style={{ borderTop: '1px solid var(--line)', background: 'var(--paper)' }}
          >
            <p className="mb-3 text-center text-[12.5px]" style={{ color: 'var(--stone)' }}>
              {statusText}
            </p>
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={handleNarrate}
                disabled={isBusy}
                className="flex h-12 items-center justify-center gap-2 rounded-full border px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'transparent', borderColor: 'var(--brass)', color: 'var(--brass)' }}
              >
                <AudioLines size={18} strokeWidth={1.5} />
                听介绍
              </button>

              <motion.button
                type="button"
                disabled={isBusy}
                onPointerDown={handlePressStart}
                onPointerUp={handlePressEnd}
                onPointerCancel={handlePressEnd}
                onPointerLeave={handlePressEnd}
                onContextMenu={(e) => e.preventDefault()}
                whileTap={{ scale: 0.92 }}
                whileHover={{ scale: recording ? 1 : 1.04 }}
                className="flex h-16 w-16 select-none items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  touchAction: 'none',
                  background: recording ? '#a63d2f' : 'var(--brass)',
                  color: 'var(--paper)',
                  boxShadow: '0 10px 24px -8px rgba(166,124,61,.55)',
                }}
                aria-label="按住说话"
              >
                <Mic size={26} strokeWidth={1.5} />
              </motion.button>

              <span className="w-[84px] text-[12px] leading-tight" style={{ color: 'var(--stone)' }}>
                {recording ? '松开结束' : '按住说话'}
              </span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/** 单条对话气泡 */
function Bubble({ role, content, live = false }: { role: 'user' | 'assistant'; content: string; live?: boolean }) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed"
        style={
          isUser
            ? { background: 'var(--brass)', color: 'var(--paper)', borderBottomRightRadius: '4px' }
            : { background: 'var(--paper-dim)', color: 'var(--ink)', borderBottomLeftRadius: '4px' }
        }
      >
        {content}
        {live && <span className="ml-0.5 inline-block animate-pulse" style={{ color: 'var(--brass)' }}>▍</span>}
      </motion.div>
    </div>
  );
}