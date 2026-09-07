/**
 * CmsForm.tsx — 策展工作台右侧表单
 *
 * 分组：基本信息 / 文案 / 素材 / 3D 摆位。
 * 集成：zod 实时校验标红（errors 传入）、双语对照编辑（BilingualField）、
 * 素材上传缩略图（AssetField）、lore AI 草稿与导览词预览（LorePanel）、
 * 「取此地坐标 / 取当前朝向」摆位辅助（playerRef → 展品坐标）。
 *
 * 字段契约以 src/config/schema.ts 的 ExhibitSchema 为唯一事实源。
 */
import { Camera, RotateCcw, Ruler, Tag, FileText, ImageIcon } from 'lucide-react';
import type { CmsExhibit, CmsZone } from '@/lib/cms';
import { BilingualField } from './BilingualField';
import { AssetField } from './AssetField';
import LorePanel from './LorePanel';

interface CmsFormProps {
  exhibit: CmsExhibit;
  zones: CmsZone[];
  /** 当前展品的字段级校验错误（key = 展品字段名） */
  errors: Record<string, string>;
  onPatch: (patch: Record<string, unknown>) => void;
  onGrabPosition: () => void;
  onGrabRotation: () => void;
}

const TYPE_OPTIONS = [
  { value: 'image', label: '图片挂画' },
  { value: 'video', label: '视频' },
  { value: 'model', label: '3D 模型' },
  { value: 'text', label: '纯文本' },
  { value: 'link', label: '外链' },
];
const MOUNT_OPTIONS = [
  { value: 'wall-frame', label: '墙面画框' },
  { value: 'pedestal', label: '基座' },
  { value: 'vitrine', label: '玻璃展柜' },
  { value: 'screen', label: '屏幕' },
  { value: 'panel', label: '展板' },
];
const FRAME_OPTIONS = [
  { value: 'oak', label: '橡木' },
  { value: 'black', label: '黑框' },
  { value: 'gilt', label: '金框' },
  { value: 'none', label: '无框' },
];

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** 通用字段外壳：label + 错误标红 + 内联错误信息 */
function Field({ label, error, children, span2 }: { label: string; error?: string; children: React.ReactNode; span2?: boolean }) {
  return (
    <div className={span2 ? 'col-span-2' : ''}>
      <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color: 'var(--stone)' }}>
        {label}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-[11px] leading-snug" style={{ color: '#a63d2f' }}>
          {error}
        </p>
      )}
    </div>
  );
}

const inputCls = (err?: string) =>
  err
    ? 'w-full rounded-lg border border-[#a63d2f] bg-transparent px-2.5 py-1.5 text-[13px] outline-none transition-colors focus:border-[var(--brass)]'
    : 'w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-[13px] outline-none transition-colors focus:border-[var(--brass)]';
const inputStyle = (err?: string): React.CSSProperties => ({ borderColor: err ? '#a63d2f' : 'var(--line)', color: 'var(--ink)' });

export default function CmsForm({ exhibit, zones, errors, onPatch, onGrabPosition, onGrabRotation }: CmsFormProps) {
  const type = str(exhibit.type) || 'image';
  const mount = str(exhibit.mount) || 'wall-frame';
  const size = (exhibit.size && typeof exhibit.size === 'object' ? exhibit.size : {}) as { w?: unknown; h?: unknown };
  const pos = Array.isArray(exhibit.position) ? (exhibit.position as unknown[]) : [];

  const patchNumber = (key: string, raw: string, fallback: number) => {
    const v = raw.trim();
    if (v !== '' && !Number.isFinite(Number(v))) return;
    onPatch({ [key]: v === '' ? fallback : Number(v) });
  };
  const patchPos = (i: number, raw: string) => {
    const arr = [num(pos[0]), num(pos[1], 1.8), num(pos[2])];
    const v = raw.trim();
    if (v !== '' && !Number.isFinite(Number(v))) return;
    arr[i] = v === '' ? 0 : Number(v);
    onPatch({ position: arr });
  };
  const patchSize = (dim: 'w' | 'h', raw: string, fallback: number) => {
    const v = raw.trim();
    if (v !== '' && !Number.isFinite(Number(v))) return;
    const next = { w: num(size.w, 2), h: num(size.h, 1.4), ...(v === '' ? {} : { [dim]: Number(v) }) };
    if (v === '') next[dim] = fallback;
    onPatch({ size: next });
  };

  return (
    <div className="space-y-7">
      {/* ---------- 基本信息 ---------- */}
      <section>
        <h3 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold tracking-wide" style={{ color: 'var(--stone)' }}>
          <Tag size={13} /> 基本信息
        </h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <Field label="编号 ID" error={errors.id}>
            <input
              id="cms-field-id"
              className={inputCls(errors.id)}
              style={inputStyle(errors.id)}
              value={str(exhibit.id)}
              onChange={(e) => onPatch({ id: e.target.value })}
            />
          </Field>
          <Field label="所属展区" error={errors.zone}>
            <select
              className={inputCls(errors.zone)}
              style={inputStyle(errors.zone)}
              value={str(exhibit.zone)}
              onChange={(e) => onPatch({ zone: e.target.value })}
            >
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name || z.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="内容类型" error={errors.type}>
            <select className={inputCls(errors.type)} style={inputStyle(errors.type)} value={type} onChange={(e) => onPatch({ type: e.target.value })}>
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="展陈方式" error={errors.mount}>
            <select className={inputCls(errors.mount)} style={inputStyle(errors.mount)} value={mount} onChange={(e) => onPatch({ mount: e.target.value })}>
              {MOUNT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {mount === 'wall-frame' && (
            <Field label="画框样式">
              <select
                className={inputCls()}
                style={inputStyle()}
                value={str(exhibit.frame) || 'oak'}
                onChange={(e) => onPatch({ frame: e.target.value })}
              >
                {FRAME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </section>

      {/* ---------- 文案 ---------- */}
      <section>
        <h3 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold tracking-wide" style={{ color: 'var(--stone)' }}>
          <FileText size={13} /> 文案（中 / EN 对照）
        </h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <BilingualField
            label="标题"
            valueZh={str(exhibit.title)}
            valueEn={str(exhibit.titleEn)}
            onChangeZh={(v) => onPatch({ title: v })}
            onChangeEn={(v) => onPatch({ titleEn: v })}
            errorZh={errors.title}
            errorEn={errors.titleEn}
            idZh="cms-field-title"
            idEn="cms-field-titleEn"
          />
          <BilingualField
            label="介绍"
            textarea
            valueZh={str(exhibit.description)}
            valueEn={str(exhibit.descriptionEn)}
            onChangeZh={(v) => onPatch({ description: v })}
            onChangeEn={(v) => onPatch({ descriptionEn: v })}
            errorZh={errors.description}
            errorEn={errors.descriptionEn}
            idZh="cms-field-description"
            idEn="cms-field-descriptionEn"
          />
          <Field label="艺术家">
            <input className={inputCls()} style={inputStyle()} value={str(exhibit.artist)} onChange={(e) => onPatch({ artist: e.target.value })} />
          </Field>
          <Field label="年代">
            <input className={inputCls()} style={inputStyle()} value={str(exhibit.year)} onChange={(e) => onPatch({ year: e.target.value })} />
          </Field>
          <Field label="媒介">
            <input className={inputCls()} style={inputStyle()} value={str(exhibit.medium)} onChange={(e) => onPatch({ medium: e.target.value })} />
          </Field>
          <Field label="版权说明">
            <input className={inputCls()} style={inputStyle()} value={str(exhibit.credit)} onChange={(e) => onPatch({ credit: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="深度知识 lore（导览员 RAG 检索的事实底座：考据 / 关联史 / 时代背景）" error={errors.lore} span2>
            <textarea
              className={`${inputCls()} min-h-[92px] resize-y leading-relaxed`}
              style={inputStyle(errors.lore)}
              value={str(exhibit.lore)}
              onChange={(e) => onPatch({ lore: e.target.value })}
              placeholder="留空则导览员仅基于介绍作答；填写后 AI 会把这些事实作为讲解依据"
            />
          </Field>
          <LorePanel
            exhibit={exhibit}
            lore={str(exhibit.lore)}
            onLoreChange={(v) => onPatch({ lore: v })}
          />
        </div>
      </section>

      {/* ---------- 素材 ---------- */}
      {(type === 'image' || type === 'video' || type === 'model' || type === 'link') && (
        <section>
          <h3 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold tracking-wide" style={{ color: 'var(--stone)' }}>
            <ImageIcon size={13} /> 素材
          </h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            {type !== 'link' && (
              <AssetField
                label={type === 'video' ? '视频地址 src' : type === 'model' ? '模型地址 src' : '图片地址 src'}
                value={str(exhibit.src)}
                onChange={(v) => onPatch({ src: v })}
                kind={type === 'video' ? 'video' : type === 'model' ? 'image' : 'image'}
                error={errors.src}
                inputId="cms-field-src"
              />
            )}
            {type === 'video' && (
              <AssetField
                label="封面图 poster"
                value={str(exhibit.poster)}
                onChange={(v) => onPatch({ poster: v })}
                kind="image"
                error={errors.poster}
                inputId="cms-field-poster"
              />
            )}
            {type === 'link' && (
              <Field label="外链地址 link" error={errors.link} span2>
                <input
                  className={inputCls(errors.link)}
                  style={inputStyle(errors.link)}
                  value={str(exhibit.link)}
                  onChange={(e) => onPatch({ link: e.target.value })}
                  placeholder="https://…"
                />
              </Field>
            )}
          </div>
        </section>
      )}

      {/* ---------- 3D 摆位 ---------- */}
      <section>
        <h3 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold tracking-wide" style={{ color: 'var(--stone)' }}>
          <Ruler size={13} /> 3D 摆位
        </h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          <Field label="位置 position（x / y / z，米）" error={errors.position} span2>
            <div className="flex items-center gap-2">
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  type="number"
                  step={0.1}
                  className={inputCls(errors.position)}
                  style={{ ...inputStyle(errors.position), minWidth: 0 }}
                  value={String(num(pos[i], i === 1 ? 1.8 : 0))}
                  onChange={(e) => patchPos(i, e.target.value)}
                />
              ))}
              <button
                type="button"
                onClick={onGrabPosition}
                title="先在展厅中走到想要的位置，再点此取玩家当前坐标"
                className="flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] transition-colors hover:border-[var(--brass)]"
                style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
              >
                <Camera size={12} /> 取此地坐标
              </button>
              <button
                type="button"
                onClick={onGrabRotation}
                title="以玩家当前朝向为展品朝向"
                className="flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] transition-colors hover:border-[var(--brass)]"
                style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
              >
                <RotateCcw size={12} /> 取朝向
              </button>
            </div>
          </Field>
          <Field label="朝向 rotationDeg（度）" error={errors.rotationDeg}>
            <input
              type="number"
              step={5}
              className={inputCls(errors.rotationDeg)}
              style={inputStyle(errors.rotationDeg)}
              value={String(num(exhibit.rotationDeg))}
              onChange={(e) => patchNumber('rotationDeg', e.target.value, 0)}
            />
          </Field>
          {mount === 'wall-frame' && (
            <Field label="画幅尺寸 size（宽 × 高，米）" error={errors.size}>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step={0.1}
                  className={inputCls(errors.size)}
                  style={{ ...inputStyle(errors.size), minWidth: 0 }}
                  value={String(num(size.w, 2))}
                  onChange={(e) => patchSize('w', e.target.value, 2)}
                />
                <input
                  type="number"
                  step={0.1}
                  className={inputCls(errors.size)}
                  style={{ ...inputStyle(errors.size), minWidth: 0 }}
                  value={String(num(size.h, 1.4))}
                  onChange={(e) => patchSize('h', e.target.value, 1.4)}
                />
              </div>
            </Field>
          )}
          {type === 'model' && (
            <>
              <Field label="模型缩放 modelScale" error={errors.modelScale}>
                <input
                  type="number"
                  step={0.1}
                  className={inputCls(errors.modelScale)}
                  style={inputStyle(errors.modelScale)}
                  value={String(num(exhibit.modelScale, 1))}
                  onChange={(e) => patchNumber('modelScale', e.target.value, 1)}
                />
              </Field>
              <Field label="模型 X 轴矫正 modelRotationDeg" error={errors.modelRotationDeg}>
                <input
                  type="number"
                  step={5}
                  className={inputCls(errors.modelRotationDeg)}
                  style={inputStyle(errors.modelRotationDeg)}
                  value={String(num(exhibit.modelRotationDeg))}
                  onChange={(e) => patchNumber('modelRotationDeg', e.target.value, 0)}
                />
              </Field>
            </>
          )}
          <Field label="聚焦半径 focusRadius" error={errors.focusRadius}>
            <input
              type="number"
              step={0.2}
              className={inputCls(errors.focusRadius)}
              style={inputStyle(errors.focusRadius)}
              value={String(num(exhibit.focusRadius, 2.6))}
              onChange={(e) => patchNumber('focusRadius', e.target.value, 2.6)}
            />
          </Field>
          <div className="col-span-2 flex items-center gap-5">
            <label className="flex cursor-pointer items-center gap-2 text-[12px]" style={{ color: 'var(--ink)' }}>
              <input type="checkbox" checked={exhibit.spotlight !== false} onChange={(e) => onPatch({ spotlight: e.target.checked })} />
              射灯照明
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[12px]" style={{ color: 'var(--ink)' }}>
              <input type="checkbox" checked={exhibit.spin === true} onChange={(e) => onPatch({ spin: e.target.checked })} />
              缓慢旋转
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}
