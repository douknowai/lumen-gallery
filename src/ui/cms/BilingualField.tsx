/**
 * BilingualField.tsx — 策展后台中英对照字段
 *
 * 中文主输入 + 英文副输入并排；英文缺失时右上角「缺 EN」角标提示。
 */
import { useI18n } from '@/lib/i18n';

interface BilingualFieldProps {
  label: string;
  valueZh: string;
  valueEn: string;
  onChangeZh: (v: string) => void;
  onChangeEn: (v: string) => void;
  textarea?: boolean;
  errorZh?: string;
  errorEn?: string;
  idZh?: string;
  idEn?: string;
}

export function BilingualField({
  label,
  valueZh,
  valueEn,
  onChangeZh,
  onChangeEn,
  textarea = false,
  errorZh,
  errorEn,
  idZh,
  idEn,
}: BilingualFieldProps) {
  const { t } = useI18n();
  const missingEn = valueZh.trim().length > 0 && valueEn.trim().length === 0;

  const sharedCls =
    'w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-[13px] outline-none transition-colors';

  const inputStyle = (error?: string): React.CSSProperties => ({
    borderColor: error ? '#a63d2f' : 'var(--line)',
    color: 'var(--ink)',
  });

  return (
    <div className="col-span-2">
      <div className="mb-1 flex items-center justify-between">
        <label
          className="text-[11px] font-medium uppercase tracking-wider"
          style={{ color: 'var(--stone)' }}
        >
          {label}
        </label>
        {missingEn && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: 'rgba(166,124,61,.12)', color: 'var(--brass)' }}
          >
            {t('cms.missingEn')}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="mb-0.5 text-[10px] uppercase" style={{ color: 'var(--stone)' }}>
            中
          </div>
          {textarea ? (
            <textarea
              id={idZh}
              value={valueZh}
              onChange={(e) => onChangeZh(e.target.value)}
              rows={4}
              className={sharedCls + ' resize-y'}
              style={inputStyle(errorZh)}
            />
          ) : (
            <input
              id={idZh}
              type="text"
              value={valueZh}
              onChange={(e) => onChangeZh(e.target.value)}
              className={sharedCls}
              style={inputStyle(errorZh)}
            />
          )}
          {errorZh && (
            <p className="mt-1 text-[11.5px]" style={{ color: '#a63d2f' }}>
              {errorZh}
            </p>
          )}
        </div>
        <div>
          <div className="mb-0.5 text-[10px] uppercase" style={{ color: 'var(--stone)' }}>
            EN
          </div>
          {textarea ? (
            <textarea
              id={idEn}
              value={valueEn}
              onChange={(e) => onChangeEn(e.target.value)}
              rows={4}
              placeholder={missingEn ? t('cms.missingEnHint') : undefined}
              className={sharedCls + ' resize-y'}
              style={{ ...inputStyle(errorEn), opacity: missingEn ? 0.85 : 1 }}
            />
          ) : (
            <input
              id={idEn}
              type="text"
              value={valueEn}
              onChange={(e) => onChangeEn(e.target.value)}
              placeholder={missingEn ? t('cms.missingEnHint') : undefined}
              className={sharedCls}
              style={inputStyle(errorEn)}
            />
          )}
          {errorEn && (
            <p className="mt-1 text-[11.5px]" style={{ color: '#a63d2f' }}>
              {errorEn}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
