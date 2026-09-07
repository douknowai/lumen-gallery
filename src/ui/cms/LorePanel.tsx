/**
 * LorePanel.tsx — lore 字段的 AI 辅助面板。
 * lore 是导览员 RAG 检索的事实底座：提供「生成考据草稿」（AI 起草、策展人校订）
 * 与「预览导览词」（基于当前表单内容实时生成，无需先保存）。
 * 生成基于真实 LLM 调用（/api/ai/lore-draft、/api/ai/narrate）。
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Ear, Loader2, Sparkles, X } from 'lucide-react';
import { CmsApiError, fetchLoreDraft, fetchNarration, type CmsExhibit } from '@/lib/cms';

interface LorePanelProps {
  exhibit: CmsExhibit;
  lore: string;
  onLoreChange: (value: string) => void;
}

export default function LorePanel({ exhibit, lore, onLoreChange }: LorePanelProps) {
  const [drafting, setDrafting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

  const generateDraft = async () => {
    setError(null);
    setDrafting(true);
    try {
      const draft = await fetchLoreDraft({
        title: str(exhibit.title),
        titleEn: str(exhibit.titleEn),
        description: str(exhibit.description),
        artist: str(exhibit.artist),
        year: str(exhibit.year),
        medium: str(exhibit.medium),
        lang: 'zh',
      });
      const stamped = lore.trim()
        ? `${lore.trim()}\n\n---\n【AI 草稿，请校订】\n${draft}`
        : `【AI 草稿，请校订后删除此行】\n${draft}`;
      onLoreChange(stamped);
    } catch (err) {
      setError(err instanceof CmsApiError ? err.message : '草稿生成失败，请稍后重试');
    } finally {
      setDrafting(false);
    }
  };

  const previewNarration = async () => {
    setError(null);
    setPreviewing(true);
    setPreviewText(null);
    try {
      const text = await fetchNarration(exhibit);
      setPreviewText(text);
    } catch (err) {
      setError(err instanceof CmsApiError ? err.message : '导览词生成失败，请稍后重试');
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={generateDraft}
          disabled={drafting || previewing}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-[var(--paper-dim)] disabled:opacity-50"
          style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
        >
          {drafting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {drafting ? '生成中…' : '生成考据草稿'}
        </button>
        <button
          type="button"
          onClick={previewNarration}
          disabled={drafting || previewing}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-[var(--paper-dim)] disabled:opacity-50"
          style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
        >
          {previewing ? <Loader2 size={13} className="animate-spin" /> : <Ear size={13} />}
          {previewing ? '生成中…' : '预览导览词'}
        </button>
        <span className="text-[11px]" style={{ color: 'var(--stone)' }}>
          AI 生成仅供参考，入库前请人工校订
        </span>
      </div>
      {error && (
        <p className="mt-1.5 text-xs" style={{ color: '#a63d2f' }}>
          {error}
        </p>
      )}

      {/* 导览词预览弹层 */}
      <AnimatePresence>
        {previewText !== null && (
          <motion.div
            key="lore-preview"
            className="fixed inset-0 z-[70] flex items-center justify-center p-6"
            style={{ background: 'rgba(24,22,18,.44)', backdropFilter: 'blur(3px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            onClick={() => setPreviewText(null)}
          >
            <motion.div
              className="w-full max-w-lg rounded-[18px] border p-5 shadow-2xl"
              style={{ background: 'var(--paper)', borderColor: 'var(--line)' }}
              initial={{ scale: 0.96, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 12 }}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                  导览词预览（当前表单内容）
                </h4>
                <button
                  type="button"
                  onClick={() => setPreviewText(null)}
                  className="rounded-full p-1 transition-colors hover:bg-[var(--paper-dim)]"
                  style={{ color: 'var(--stone)' }}
                  aria-label="关闭预览"
                >
                  <X size={16} />
                </button>
              </div>
              <div
                className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-[13.5px] leading-relaxed"
                style={{ color: 'var(--ink)' }}
              >
                {previewText}
              </div>
              <p className="mt-3 text-[11px]" style={{ color: 'var(--stone)' }}>
                图片展品的看图讲解将在保存并进入展厅后生效。
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
