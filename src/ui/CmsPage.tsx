/**
 * CmsPage — 可视化策展后台（/cms）
 *
 * 数据驱动策展：读写 public/data/exhibits.json（dev 落盘；prod 临时写 /tmp）。
 * 提供展品的增删改，字段覆盖文案、素材与 3D 摆位，从「作品」升级为「可交付给展馆的工具」。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';

type CmsExhibit = Record<string, unknown> & { id: string };

interface CmsData {
  gallery: Record<string, unknown>;
  zones: { id: string; name: string; nameEn?: string }[];
  exhibits: CmsExhibit[];
}

const MOUNT_OPTIONS = ['wall-frame', 'pedestal', 'vitrine', 'screen', 'panel'];
const TYPE_OPTIONS = ['image', 'video', 'model', 'text', 'link'];
const FRAME_OPTIONS = ['oak', 'black', 'gilt', 'none'];

function str(v: unknown): string {
  if (v == null) return '';
  return typeof v === 'string' ? v : String(v);
}

function fieldLabel(text: string) {
  return <label className="col-span-1 pt-2 text-[11px] uppercase tracking-wide text-[var(--stone)]">{text}</label>;
}

/** 通用文本字段 */
function TextField({
  label,
  value,
  onChange,
  textarea = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  const cls =
    'col-span-3 rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brass)]';
  return (
    <>
      {fieldLabel(label)}
      {textarea ? (
        <textarea className={cls + ' min-h-[72px]'} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={cls} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </>
  );
}

export default function CmsPage() {
  const [data, setData] = useState<CmsData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const r = await fetch('/api/cms/exhibits');
      const j = await r.json();
      if (!j.success) throw new Error('读取失败');
      setData({ gallery: j.gallery, zones: j.zones, exhibits: j.exhibits });
      if (j.exhibits?.length && !selectedId) setSelectedId(j.exhibits[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取失败');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selected = useMemo(
    () => data?.exhibits.find((e) => e.id === selectedId) ?? null,
    [data, selectedId],
  );

  function patch(id: string, patchObj: Record<string, unknown>) {
    setData((d) =>
      d ? { ...d, exhibits: d.exhibits.map((e) => (e.id === id ? ({ ...e, ...patchObj } as CmsExhibit) : e)) } : d,
    );
    setDirty(true);
  }

  function patchPosition(idx: number, value: number) {
    if (!selected) return;
    const pos = Array.isArray(selected.position) ? [...(selected.position as number[])] : [0, 0, 0];
    while (pos.length < 3) pos.push(0);
    pos[idx] = value;
    patch(selected.id, { position: pos });
  }

  function patchSize(key: 'w' | 'h', value: number) {
    if (!selected) return;
    const size = (selected.size as { w?: number; h?: number } | undefined) ?? {};
    patch(selected.id, { size: { ...size, [key]: value } });
  }

  function addExhibit() {
    const zones = data?.zones ?? [];
    const id = `X-${String((data?.exhibits.length ?? 0) + 1).padStart(2, '0')}`;
    const neo: CmsExhibit = {
      id,
      type: 'image',
      zone: zones[0]?.id ?? '',
      mount: 'wall-frame',
      title: '新展品',
      titleEn: 'New Exhibit',
      artist: '',
      year: '',
      medium: '',
      credit: '',
      description: '在此填写展品介绍文案',
      descriptionEn: '',
      lore: '',
      src: '',
      poster: '',
      link: '',
      position: [0, 1.6, 0],
      rotationDeg: 0,
      size: { w: 1.2, h: 1.5 },
      frame: 'oak',
      focusRadius: 2.6,
      spotlight: true,
      modelScale: 1,
      spin: false,
    };
    setData((d) => (d ? { ...d, exhibits: [...d.exhibits, neo] } : d));
    setSelectedId(id);
    setDirty(true);
  }

  function removeExhibit(id: string) {
    if (!confirm('确定删除该展品？此操作不可撤销。')) return;
    setData((d) => (d ? { ...d, exhibits: d.exhibits.filter((e) => e.id !== id) } : d));
    if (selectedId === id) setSelectedId(null);
    setDirty(true);
  }

  async function save() {
    if (!data) return;
    setStatus(null);
    setError(null);
    try {
      const r = await fetch('/api/cms/exhibits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exhibits: data.exhibits }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '保存失败');
      setDirty(false);
      setStatus({ ok: true, text: j.warning ?? `已保存 ${j.count} 件展品` });
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : '保存失败' });
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--paper)] text-[var(--ink)]">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--line)] bg-[var(--paper)]/90 px-5 py-3 backdrop-blur">
        <Link
          to="/"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] text-[var(--stone)] transition hover:border-[var(--brass)] hover:text-[var(--brass)]"
          title="返回展厅"
        >
          <ArrowLeft size={18} strokeWidth={1.5} />
        </Link>
        <div className="flex-1">
          <h1 className="font-serif-lumen text-lg leading-none">策展后台</h1>
          <p className="mt-1 text-xs text-[var(--stone)]">编辑展品文案、素材与 3D 摆位</p>
        </div>
        {dirty && <span className="text-xs text-[var(--stone)]">有未保存改动</span>}
        <button
          onClick={() => void save()}
          disabled={!dirty}
          className="flex items-center gap-2 rounded-full bg-[var(--brass)] px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save size={16} strokeWidth={1.5} />
          保存
        </button>
      </header>

      {status && (
        <div
          className={`mx-5 mt-4 rounded-md border px-4 py-2 text-sm ${
            status.ok
              ? 'border-[var(--brass)]/40 bg-[var(--brass)]/10'
              : 'border-[#a63d2f]/40 bg-[#a63d2f]/10 text-[#a63d2f]'
          }`}
        >
          {status.text}
        </div>
      )}
      {error && (
        <div className="mx-5 mt-4 rounded-md border border-[#a63d2f]/40 bg-[#a63d2f]/10 px-4 py-2 text-sm text-[#a63d2f]">
          {error}
        </div>
      )}

      <main className="grid gap-5 p-5 lg:grid-cols-[300px_1fr]">
        {/* 展品列表 */}
        <aside className="flex flex-col gap-2">
          <button
            onClick={addExhibit}
            className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--brass)]/50 px-3 py-2.5 text-sm text-[var(--brass)] transition hover:bg-[var(--brass)]/10"
          >
            <Plus size={16} strokeWidth={1.5} />
            新增展品
          </button>
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            {data?.exhibits.map((e) => (
              <div
                key={e.id}
                onClick={() => setSelectedId(e.id)}
                className={`group mb-2 cursor-pointer rounded-lg border px-3 py-2 transition ${
                  selectedId === e.id
                    ? 'border-[var(--brass)] bg-[var(--brass)]/10'
                    : 'border-[var(--line)] hover:border-[var(--brass)]/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{str(e.title)}</div>
                    <div className="truncate text-xs text-[var(--stone)]">
                      {str(e.id)} · {str(e.zone)} · {str(e.type)}
                    </div>
                  </div>
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      removeExhibit(e.id);
                    }}
                    className="shrink-0 rounded p-1 text-[var(--stone)] opacity-0 transition hover:text-[#a63d2f] group-hover:opacity-100"
                    title="删除"
                  >
                    <Trash2 size={15} strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            ))}
            {!data?.exhibits.length && <p className="py-6 text-center text-sm text-[var(--stone)]">暂无展品</p>}
          </div>
        </aside>

        {/* 编辑表单 */}
        <section className="min-w-0">
          {!selected ? (
            <p className="py-16 text-center text-sm text-[var(--stone)]">在左侧选择或新增一件展品开始编辑</p>
          ) : (
            <div className="space-y-6">
              <Section title="基本信息">
                <div className="grid grid-cols-4 gap-3">
                  <TextField label="ID" value={str(selected.id)} onChange={(v) => patch(selected.id, { id: v })} />

                  {fieldLabel('类型')}
                  <select
                    className="col-span-3 w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brass)]"
                    value={str(selected.type)}
                    onChange={(e) => patch(selected.id, { type: e.target.value })}
                  >
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>

                  {fieldLabel('展陈')}
                  <select
                    className="col-span-3 w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brass)]"
                    value={str(selected.mount)}
                    onChange={(e) => patch(selected.id, { mount: e.target.value })}
                  >
                    {MOUNT_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>

                  {fieldLabel('展区')}
                  <select
                    className="col-span-3 w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brass)]"
                    value={str(selected.zone)}
                    onChange={(e) => patch(selected.id, { zone: e.target.value })}
                  >
                    {data?.zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </select>

                  <TextField label="标题" value={str(selected.title)} onChange={(v) => patch(selected.id, { title: v })} />
                  <TextField label="标题(英)" value={str(selected.titleEn)} onChange={(v) => patch(selected.id, { titleEn: v })} />
                  <TextField label="作者" value={str(selected.artist)} onChange={(v) => patch(selected.id, { artist: v })} />
                  <TextField label="年代" value={str(selected.year)} onChange={(v) => patch(selected.id, { year: v })} />
                  <TextField label="媒材" value={str(selected.medium)} onChange={(v) => patch(selected.id, { medium: v })} />
                  <TextField label="出处" value={str(selected.credit)} onChange={(v) => patch(selected.id, { credit: v })} />
                </div>
              </Section>

              <Section title="文案">
                <div className="grid grid-cols-4 gap-3">
                  <TextField
                    label="介绍"
                    textarea
                    value={str(selected.description)}
                    onChange={(v) => patch(selected.id, { description: v })}
                  />
                  <TextField
                    label="介绍(英)"
                    textarea
                    value={str(selected.descriptionEn)}
                    onChange={(v) => patch(selected.id, { descriptionEn: v })}
                  />
                  <TextField
                    label="考据/关联史（RAG 召回用）"
                    textarea
                    value={str(selected.lore)}
                    onChange={(v) => patch(selected.id, { lore: v })}
                  />
                </div>
              </Section>

              <Section title="素材">
                <div className="grid grid-cols-4 gap-3">
                  <TextField label="资源 src" value={str(selected.src)} onChange={(v) => patch(selected.id, { src: v })} />
                  <TextField label="封面 poster" value={str(selected.poster)} onChange={(v) => patch(selected.id, { poster: v })} />
                  <TextField label="外链 link" value={str(selected.link)} onChange={(v) => patch(selected.id, { link: v })} />
                </div>
              </Section>

              <Section title="3D 摆位">
                <div className="grid grid-cols-4 gap-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="col-span-1">
                      {fieldLabel(['X (m)', 'Y (m)', 'Z (m)'][i])}
                      <input
                        type="number"
                        step="0.1"
                        className="w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brass)]"
                        value={Array.isArray(selected.position) ? (selected.position as number[])[i] ?? 0 : 0}
                        onChange={(e) => patchPosition(i, Number(e.target.value))}
                      />
                    </div>
                  ))}
                  <div className="col-span-1">
                    {fieldLabel('旋转角度')}
                    <input
                      type="number"
                      step="1"
                      className="w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brass)]"
                      value={Number(selected.rotationDeg ?? 0)}
                      onChange={(e) => patch(selected.id, { rotationDeg: Number(e.target.value) })}
                    />
                  </div>
                  <div className="col-span-1">
                    {fieldLabel('聚焦半径')}
                    <input
                      type="number"
                      step="0.1"
                      className="w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brass)]"
                      value={Number(selected.focusRadius ?? 2.6)}
                      onChange={(e) => patch(selected.id, { focusRadius: Number(e.target.value) })}
                    />
                  </div>

                  {fieldLabel('画框')}
                  <select
                    className="col-span-3 w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brass)]"
                    value={str(selected.frame)}
                    onChange={(e) => patch(selected.id, { frame: e.target.value || undefined })}
                  >
                    <option value="">未设置</option>
                    {FRAME_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>

                  <div className="col-span-1">
                    {fieldLabel('宽 W (m)')}
                    <input
                      type="number"
                      step="0.1"
                      className="w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brass)]"
                      value={Number(((selected.size as { w?: number } | undefined) ?? {}).w ?? 1.2)}
                      onChange={(e) => patchSize('w', Number(e.target.value))}
                    />
                  </div>
                  <div className="col-span-1">
                    {fieldLabel('高 H (m)')}
                    <input
                      type="number"
                      step="0.1"
                      className="w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brass)]"
                      value={Number(((selected.size as { h?: number } | undefined) ?? {}).h ?? 1.5)}
                      onChange={(e) => patchSize('h', Number(e.target.value))}
                    />
                  </div>
                  <div className="col-span-1">
                    {fieldLabel('模型缩放')}
                    <input
                      type="number"
                      step="0.1"
                      className="w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brass)]"
                      value={Number(selected.modelScale ?? 1)}
                      onChange={(e) => patch(selected.id, { modelScale: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!selected.spotlight}
                      onChange={(e) => patch(selected.id, { spotlight: e.target.checked })}
                    />
                    射灯
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!selected.spin}
                      onChange={(e) => patch(selected.id, { spin: e.target.checked })}
                    />
                    自动旋转
                  </label>
                </div>
              </Section>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-dim)] p-4">
      <h2 className="mb-3 font-serif-lumen text-base">{title}</h2>
      {children}
    </div>
  );
}