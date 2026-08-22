/**
 * GuideAssistant.tsx — 全馆「AI 导览员」。
 *
 * 与「单件展品打电话」不同，导览员面向整个展馆：帮观众推荐展品、
 * 规划参观路线、回答策展问题。事实底座由 exhibits.json 汇总的 catalog 提供，
 * 对话走 guideStream（LLM 流式），历史持久化到 localStorage。
 *
 * 交互形态：右下角悬浮入口 → 展开为对话卡片（纸墨 + 黄铜，复用对话气泡规范）。
 * 导览员为文字对话（适合长问题与路线规划），暂不接语音。
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Compass, Send, X } from 'lucide-react';
import { useStore } from '@/state/store';
import { guideStream, loadGuideHistory, saveGuideHistory, type ChatMessage, type GuideCatalogItem } from '@/lib/ai';
import { useI18n } from '@/lib/i18n';

export default function GuideAssistant() {
  const guideOpen = useStore((s) => s.guideOpen);
  const openGuide = useStore((s) => s.openGuide);
  const closeGuide = useStore((s) => s.closeGuide);
  const data = useStore((s) => s.data);
  const isMobile = useStore((s) => s.isMobile);
  const appState = useStore((s) => s.appState);
  const { t } = useI18n();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const historyRef = useRef<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  /* 展品清单 → 导览员事实底座 */
  const catalog = useMemo<GuideCatalogItem[]>(() => {
    if (!data) return [];
    const zoneNameOf = (id: string) => data.zones.find((z) => z.id === id)?.name ?? '';
    return data.exhibits.map((e) => ({
      id: e.id,
      title: e.title,
      titleEn: e.titleEn,
      artist: e.artist,
      type: e.type,
      zone: e.zone,
      zoneName: zoneNameOf(e.zone),
      description: e.description,
    }));
  }, [data]);

  /* 载入导览员历史 */
  useEffect(() => {
    const saved = loadGuideHistory();
    historyRef.current = saved;
    setMessages(saved);
  }, []);

  /* 新消息滚动到底部 */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setMessages((prev) => [...prev, { role: 'user', content: text }]);
      historyRef.current.push({ role: 'user', content: text });
      setInput('');
      setStreaming('');
      setBusy(true);
      setError(null);

      let full = '';
      try {
        const history = historyRef.current.slice(0, -1).slice(-8);
        for await (const delta of guideStream(catalog, text, history)) {
          full += delta;
          setStreaming(full);
        }
        const final = full.trim() || t('guide.error');
        historyRef.current.push({ role: 'assistant', content: final });
        saveGuideHistory(historyRef.current);
        setMessages((prev) => [...prev, { role: 'assistant', content: final }]);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('guide.error'));
      } finally {
        setStreaming(null);
        setBusy(false);
      }
    },
    [busy, catalog, t],
  );

  const onSubmit = useCallback(() => {
    void send(input);
  }, [send, input]);

  const displayMessages = streaming !== null ? [...messages, { role: 'assistant' as const, content: streaming }] : messages;

  /* 悬浮入口仅在自由参观（explore）时显示，避免与登录/弹窗/设置界面重叠 */
  const showFab = !guideOpen && appState === 'explore';

  return (
    <>
      {/* 悬浮入口 */}
      <AnimatePresence>
        {showFab && (
          <motion.button
            key="guide-fab"
            type="button"
            onClick={openGuide}
            className="pointer-events-auto fixed right-4 z-[45] flex items-center gap-2 rounded-full border px-4 py-3 shadow-lg"
            style={{
              bottom: 'calc(env(safe-area-inset-bottom) + 5.5rem)',
              background: 'var(--ink)',
              color: 'var(--paper)',
              borderColor: 'rgba(166,124,61,.5)',
              boxShadow: '0 16px 40px -14px rgba(20,18,15,.6)',
            }}
            initial={{ opacity: 0, scale: 0.85, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 12 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            title={t('guide.openChat')}
          >
            <Compass size={18} strokeWidth={1.5} style={{ color: 'var(--brass)' }} />
            <span className="font-serif-lumen text-[13px] tracking-wide">{t('guide.title')}</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* 对话面板 */}
      <AnimatePresence>
        {guideOpen && (
          <motion.div
            key="guide-panel"
            className="fixed z-[46] flex flex-col overflow-hidden border"
            style={{
              background: 'var(--paper)',
              borderColor: 'var(--line)',
              borderRadius: isMobile ? '20px 20px 0 0' : '18px',
              boxShadow: '0 24px 80px -20px rgba(20,18,15,.5)',
              right: isMobile ? 8 : 16,
              bottom: isMobile ? 0 : 'calc(env(safe-area-inset-bottom) + 1rem)',
              width: isMobile ? 'calc(100vw - 16px)' : 'min(420px, calc(100vw - 2rem))',
              height: isMobile ? 'min(70vh, 560px)' : 'min(560px, 72vh)',
            }}
            initial={isMobile ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 16 }}
            animate={isMobile ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={isMobile ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          >
            {/* 头部 */}
            <div className="flex shrink-0 items-center gap-3 px-5 py-3.5" style={{ borderBottom: '1px solid var(--line)' }}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--brass)', color: 'var(--paper)' }}>
                <Compass size={20} strokeWidth={1.5} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-serif-lumen text-[15px] font-medium" style={{ color: 'var(--ink)' }}>{t('guide.title')}</div>
                <div className="mt-0.5 font-mono-lumen text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--stone)' }}>{t('guide.subtitle')}</div>
              </div>
              <button
                type="button"
                onClick={closeGuide}
                className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--paper-dim)]"
                title={t('guide.close')}
                aria-label={t('guide.close')}
              >
                <X size={18} strokeWidth={1.5} style={{ color: 'var(--stone)' }} />
              </button>
            </div>

            {/* 消息区 */}
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {displayMessages.length === 0 && (
                <div className="flex justify-start">
                  <div
                    className="max-w-[85%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed"
                    style={{ background: 'var(--paper-dim)', color: 'var(--ink)', borderBottomLeftRadius: 4 }}
                  >
                    {t('guide.greeting')}
                  </div>
                </div>
              )}
              {displayMessages.map((m, i) => {
                const isUser = m.role === 'user';
                return (
                  <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed"
                      style={
                        isUser
                          ? { background: 'var(--brass)', color: 'var(--paper)', borderBottomRightRadius: 4 }
                          : { background: 'var(--paper-dim)', color: 'var(--ink)', borderBottomLeftRadius: 4 }
                      }
                    >
                      {m.content}
                    </div>
                  </div>
                );
              })}
              {error && (
                <div className="text-center font-mono-lumen text-[11px]" style={{ color: '#a63d2f' }}>{error}</div>
              )}
            </div>

            {/* 输入区 */}
            <div className="shrink-0 border-t px-3 py-3" style={{ borderColor: 'var(--line)', background: 'var(--paper)' }}>
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      onSubmit();
                    }
                  }}
                  rows={1}
                  placeholder={t('guide.placeholder')}
                  className="min-h-[44px] flex-1 resize-none rounded-xl border bg-transparent px-3.5 py-2.5 text-[14px] outline-none"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
                />
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={busy || !input.trim()}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
                  style={{ background: 'var(--brass)', color: 'var(--paper)' }}
                  title={t('guide.send')}
                  aria-label={t('guide.send')}
                >
                  <Send size={18} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}