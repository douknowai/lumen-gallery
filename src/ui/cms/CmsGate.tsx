/**
 * CmsGate.tsx — 策展后台口令门禁。
 * 后端配置 CMS_PASSCODE 后，所有写操作（保存/上传）需要 Bearer 令牌；
 * 此组件以弹层形式收集口令、换取令牌（sessionStorage），关闭后继续被拦截的操作。
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { KeyRound, Loader2, X } from 'lucide-react';
import { CmsApiError, cmsLogin } from '@/lib/cms';

interface CmsGateProps {
  onAuthed: () => void;
  onCancel: () => void;
}

export default function CmsGate({ onAuthed, onCancel }: CmsGateProps) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* 组件由父级条件渲染：每次打开都是全新实例，状态天然重置，无需复位 effect */
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  const submit = async () => {
    if (!passcode.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await cmsLogin(passcode.trim());
      onAuthed();
    } catch (err) {
      setError(err instanceof CmsApiError ? err.message : '口令校验失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="cms-gate"
          className="fixed inset-0 z-[80] flex items-center justify-center p-6"
          style={{ background: 'rgba(24,22,18,.5)', backdropFilter: 'blur(4px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        >
          <motion.div
            className="w-full max-w-sm rounded-[18px] border p-6 shadow-2xl"
            style={{ background: 'var(--paper)', borderColor: 'var(--line)' }}
            initial={{ scale: 0.96, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 12 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          >
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full"
                  style={{ background: 'var(--brass)', color: 'var(--paper)' }}
                >
                  <KeyRound size={16} strokeWidth={1.6} />
                </div>
                <div>
                  <h3 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    策展后台已开启保护
                  </h3>
                  <p className="mt-0.5 text-[11px]" style={{ color: 'var(--stone)' }}>
                    保存与上传需要访问口令
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-full p-1 transition-colors hover:bg-[var(--paper-dim)]"
                style={{ color: 'var(--stone)' }}
                aria-label="取消"
              >
                <X size={16} />
              </button>
            </div>

            <input
              ref={inputRef}
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              placeholder="访问口令"
              className="w-full rounded-lg border bg-transparent px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--brass)]"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
            />
            {error && (
              <p className="mt-2 text-xs" style={{ color: '#a63d2f' }}>
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !passcode.trim()}
              className="mt-4 w-full rounded-lg py-2.5 text-sm transition-opacity disabled:opacity-50"
              style={{ background: 'var(--brass)', color: 'var(--paper)' }}
            >
              <span className="inline-flex items-center gap-1.5">
                {busy && <Loader2 size={14} className="animate-spin" />}
                验证并继续
              </span>
            </button>
            <p className="mt-3 text-[11px]" style={{ color: 'var(--stone)' }}>
              口令由部署方通过环境变量 CMS_PASSCODE 配置，验证后本会话内有效。
            </p>
          </motion.div>
        </motion.div>
      </AnimatePresence>
  );
}
