/**
 * CmsConfirm.tsx — 策展后台纸墨风确认弹层
 *
 * 替换原生 window.confirm：useCmsConfirm() 返回 [element, confirm(opts)]，
 * confirm 返回 Promise<boolean>，await 后再执行删除等危险操作。
 */
import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export interface CmsConfirmOptions {
  title: string;
  message: string;
  danger?: boolean;
}

export function useCmsConfirm(): [
  React.ReactNode,
  (opts: CmsConfirmOptions) => Promise<boolean>,
] {
  const { t } = useI18n();
  const [pending, setPending] = useState<CmsConfirmOptions | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: CmsConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setPending(opts);
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setPending(null);
  }, []);

  const element = (
    <AnimatePresence>
      {pending && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={() => settle(false)}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-[16px] border p-5 shadow-2xl"
            style={{ background: 'var(--paper)', borderColor: 'var(--line)' }}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={
                  pending.danger
                    ? { background: 'rgba(166,61,47,.12)', color: '#a63d2f' }
                    : { background: 'rgba(166,124,61,.14)', color: 'var(--brass)' }
                }
              >
                <AlertTriangle size={16} strokeWidth={1.6} />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className="font-serif-lumen text-[16px] font-semibold"
                  style={{ color: 'var(--ink)' }}
                >
                  {pending.title}
                </div>
                <div className="mt-1.5 text-[13px] leading-relaxed" style={{ color: 'var(--stone)' }}>
                  {pending.message}
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-full border px-4 py-1.5 text-[13px] transition-colors hover:opacity-70"
                style={{ borderColor: 'var(--line)', color: 'var(--stone)' }}
                onClick={() => settle(false)}
              >
                {t('cms.cancel')}
              </button>
              <button
                type="button"
                className="rounded-full px-4 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-85"
                style={{ background: pending.danger ? '#a63d2f' : 'var(--brass)' }}
                onClick={() => settle(true)}
              >
                {pending.danger ? t('cms.delete') : t('cms.ok')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return [element, confirm];
}
