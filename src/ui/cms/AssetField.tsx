/**
 * AssetField.tsx — 策展后台素材字段
 *
 * 图片/视频地址输入 + 本地文件上传（走 /api/cms/upload 落对象存储，
 * 返回同源代理 URL，可直接用于展厅贴图与展示）+ 即时缩略图预览。
 */
import { useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { fileToBase64, uploadAsset } from '@/lib/cms';

interface AssetFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** 'image' 显示缩略图预览；'video' 显示视频标记 */
  kind?: 'image' | 'video' | 'link';
  error?: string;
  inputId?: string;
}

export function AssetField({ label, value, onChange, kind = 'image', error, inputId }: AssetFieldProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const pickFile = () => fileRef.current?.click();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    if (file.size > 10 * 1024 * 1024) {
      setUploadError(t('cms.asset.tooLarge'));
      return;
    }
    setUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const url = await uploadAsset(file.name, file.type || 'application/octet-stream', base64);
      onChange(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const isImg = kind === 'image' && Boolean(value);

  return (
    <div className="col-span-2">
      <label
        htmlFor={inputId}
        className="mb-1 block text-[11px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--stone)' }}
      >
        {label}
      </label>
      <div className="flex items-start gap-2.5">
        {isImg ? (
          <div
            className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border"
            style={{ borderColor: 'var(--line)', background: 'var(--paper-dim)' }}
          >
            <img
              src={value}
              alt={label}
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = '0.15';
              }}
              onLoad={(e) => {
                (e.target as HTMLImageElement).style.opacity = '1';
              }}
            />
          </div>
        ) : kind === 'video' && value ? (
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border text-[10px]"
            style={{ borderColor: 'var(--line)', background: 'var(--paper-dim)', color: 'var(--stone)' }}
          >
            MP4
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex gap-2">
            <input
              id={inputId}
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={t('cms.asset.placeholder')}
              className="min-w-0 flex-1 rounded-lg border bg-transparent px-2.5 py-1.5 text-[13px] outline-none transition-colors focus:outline-none"
              style={{
                borderColor: error ? '#a63d2f' : 'var(--line)',
                color: 'var(--ink)',
              }}
            />
            {value && (
              <button
                type="button"
                title={t('cms.asset.clear')}
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--line)', color: 'var(--stone)' }}
                onClick={() => onChange('')}
              >
                <X size={14} />
              </button>
            )}
            <button
              type="button"
              disabled={uploading}
              className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-opacity hover:opacity-85 disabled:opacity-50"
              style={{ background: 'var(--brass)', color: 'var(--paper)' }}
              onClick={pickFile}
            >
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
              {uploading ? t('cms.asset.uploading') : t('cms.asset.upload')}
            </button>
          </div>
          {(error || uploadError) && (
            <p className="mt-1 text-[11.5px]" style={{ color: '#a63d2f' }}>
              {error || uploadError}
            </p>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={kind === 'video' ? 'video/mp4,video/webm' : 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/svg+xml'}
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
    </div>
  );
}
