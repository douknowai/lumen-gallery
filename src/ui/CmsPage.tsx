/**
 * CmsPage.tsx — 可视化策展工作台（/cms）。
 *
 * 本轮升级（策展效率闭环）：
 * - P0-1 预览闭环：「去展厅看」→ 跳回展厅瞬移到展品前并打开介绍（useCmsPreview）
 * - P0-2 摆位辅助：「取此地坐标 / 取朝向」直接读展厅玩家位置
 * - P0-3 实时校验：zod 前置校验，列表错误徽标 + 表单字段标红
 * - P1-4 素材上传：对象存储上传 + 表单/列表缩略图（AssetField）
 * - P1-5 双语对照编辑 + 缺译统计徽标（BilingualField）
 * - P1-6 展品克隆 + 按展区分组列表
 * - P1-7 草稿自动保存/恢复 + 纸墨确认弹层（useCmsConfirm）
 * - P2-8 AI 辅助：lore 草稿生成 / 导览词预览（LorePanel）
 * - P2-9 持久化状态徽标（文件 / Supabase / 降级）
 * - P2-10 口令门禁：写入操作前按需弹出（CmsGate）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown, Copy, Database, Eye, HardDrive, Languages, Link2, Plus, Save, Search, Trash2, TriangleAlert, X,
} from 'lucide-react';
import { playerRef } from '@/state/store';
import { ExhibitSchema } from '@/config/schema';
import {
  CmsApiError, clearCmsToken, fetchAuthStatus, fetchExhibits, getCmsToken, saveExhibits,
  type CmsData, type CmsExhibit, type CmsFetchMeta, type CmsZone,
} from '@/lib/cms';
import CmsForm from './cms/CmsForm';
import CmsGate from './cms/CmsGate';
import { useCmsConfirm } from './cms/CmsConfirm';

const DRAFT_KEY = 'lumen.cmsDraft';

const round2 = (v: number) => Math.round(v * 100) / 100;

function timeAgo(ts: number): string {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

function blankExhibit(zoneId: string): CmsExhibit {
  return {
    id: `new-${Date.now().toString(36)}`,
    type: 'image',
    mount: 'wall-frame',
    zone: zoneId,
    title: '新展品',
    titleEn: 'New Exhibit',
    description: '请填写展品介绍。',
    descriptionEn: 'Please write the description.',
    src: '',
    frame: 'oak',
    position: [0, 1.8, 0],
    rotationDeg: 0,
    focusRadius: 2.6,
    spotlight: true,
    spin: false,
  };
}

function TypeIcon({ type }: { type: string }) {
  const style = { width: 34, height: 34 };
  if (type === 'video') return <span style={style} className="flex items-center justify-center rounded-[8px] border border-[var(--line)] text-[var(--stone)]">▶</span>;
  if (type === 'link') return <span style={style} className="flex items-center justify-center rounded-[8px] border border-[var(--line)] text-[var(--stone)]"><Link2 size={14} /></span>;
  return <span style={style} className="flex items-center justify-center rounded-[8px] border border-[var(--line)] text-[11px] text-[var(--stone)]">{type}</span>;
}

export default function CmsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<CmsData | null>(null);
  const [meta, setMeta] = useState<CmsFetchMeta | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [draftInfo, setDraftInfo] = useState<{ savedAt: number; data: CmsData } | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const gateResolver = useRef<(() => void) | null>(null);
  const gateNextAction = useRef<(() => void) | null>(null);
  const [confirmNode, confirm] = useCmsConfirm();

  const selected = useMemo(
    () => data?.exhibits.find((e) => e.id === selectedId) ?? null,
    [data, selectedId],
  );

  /* ---------------- 加载（含口令状态 / 持久化状态 / 草稿检测） ---------------- */
  const load = useCallback(async () => {
    try {
      const st = await fetchAuthStatus();
      setAuthRequired(st.required);
      const { data: d, meta: m } = await fetchExhibits();
      setData(d);
      setMeta(m);
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { savedAt: number; data: CmsData };
          // 草稿与服务器内容一致时不打扰
          if (JSON.stringify(parsed.data.exhibits) !== JSON.stringify(d.exhibits)) {
            setDraftInfo({ savedAt: parsed.savedAt, data: parsed.data });
          } else {
            localStorage.removeItem(DRAFT_KEY);
          }
        } catch { localStorage.removeItem(DRAFT_KEY); }
      }
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof Error ? err.message : '加载展品数据失败' });
    }
  }, []);

  /* 定时器延迟触发，规避 effect 体内同步 setState 的级联渲染（react-hooks 规则） */
  useEffect(() => {
    const t = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  /* ---------------- 草稿自动保存（P1-7） ---------------- */
  useEffect(() => {
    if (!data || !dirty) return;
    const t = window.setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), data })); } catch { /* 空间不足时静默 */ }
    }, 800);
    return () => window.clearTimeout(t);
  }, [data, dirty]);

  /* ---------------- 编辑与选择 ---------------- */
  const patchSelected = useCallback((patch: Record<string, unknown>) => {
    if (!selected) return;
    setData((prev) => prev
      ? { ...prev, exhibits: prev.exhibits.map((e) => (e.id === selected.id ? { ...e, ...patch } : e)) }
      : prev);
    setDirty(true);
    setBanner(null);
  }, [selected]);

  const selectExhibit = useCallback((id: string) => {
    setSelectedId(id);
    setBanner(null);
  }, []);

  /* ---------------- 实时校验（P0-3） ---------------- */
  const allErrors = useMemo(() => {
    const map: Record<string, Record<string, string>> = {};
    for (const e of data?.exhibits ?? []) {
      const r = ExhibitSchema.safeParse(e);
      if (r.success) continue;
      const fields: Record<string, string> = {};
      for (const issue of r.error.issues) {
        const key = String(issue.path[0] ?? '_');
        if (!fields[key]) fields[key] = issue.message;
      }
      map[e.id] = fields;
    }
    return map;
  }, [data]);

  const errorCount = Object.keys(allErrors).length;

  const missingEn = useMemo(
    () => (data?.exhibits ?? []).filter((e) => !String(e.titleEn ?? '').trim() || !String(e.descriptionEn ?? '').trim()),
    [data],
  );

  /* ---------------- 口令门禁（P2-10） ---------------- */
  const ensureToken = useCallback(async (afterAuth?: () => void) => {
    if (!authRequired) { afterAuth?.(); return; }
    if (getCmsToken()) { afterAuth?.(); return; }
    gateNextAction.current = afterAuth ?? null;
    setGateOpen(true);
    await new Promise<void>((resolve) => { gateResolver.current = resolve; });
  }, [authRequired]);

  const onGateAuthed = useCallback(() => {
    setGateOpen(false);
    gateResolver.current?.();
    gateResolver.current = null;
    const next = gateNextAction.current;
    gateNextAction.current = null;
    next?.();
  }, []);

  const onGateCancel = useCallback(() => {
    setGateOpen(false);
    gateResolver.current?.();
    gateResolver.current = null;
    gateNextAction.current = null;
  }, []);

  /* ---------------- 保存 ---------------- */
  const handleSaveRef = useRef<() => Promise<void>>(async () => {});
  const handleSave = useCallback(async () => {
    if (!data) return;
    if (errorCount > 0) {
      setBanner({ kind: 'error', text: `有 ${errorCount} 件展品存在校验错误，请修正后再保存（列表中的红色标记可快速定位）。` });
      return;
    }
    await ensureToken(async () => {
      setSaving(true);
      try {
        const r = await saveExhibits(data.exhibits);
        setDirty(false);
        localStorage.removeItem(DRAFT_KEY);
        setDraftInfo(null);
        setMeta((prev) => (prev ? { ...prev, warning: typeof r.warning === 'string' ? r.warning : undefined } : prev));
        setBanner({ kind: 'success', text: `已保存 ${r.count ?? data.exhibits.length} 件展品。${r.warning ?? ''}` });
      } catch (err) {
        if (err instanceof CmsApiError && err.code === 401) {
          clearCmsToken();
          setBanner({ kind: 'error', text: '口令已失效，请重新验证。' });
          await ensureToken(() => { void handleSaveRef.current(); });
          return;
        }
        if (err instanceof CmsApiError && err.code === 400) {
          const errs = err.payload.errors;
          const text = Array.isArray(errs) && errs.length ? (errs as string[]).join('\n') : err.message;
          setBanner({ kind: 'error', text: `服务器校验未通过：\n${text}` });
          return;
        }
        setBanner({ kind: 'error', text: err instanceof Error ? err.message : '保存失败' });
      } finally {
        setSaving(false);
      }
    });
  }, [data, errorCount, ensureToken]);
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);

  /* ---------------- 克隆（P1-6） ---------------- */
  const cloneExhibit = useCallback((e: CmsExhibit) => {
    if (!data) return;
    const copy: CmsExhibit = {
      ...e,
      id: `${e.id}-c${Date.now().toString(36).slice(-4)}`,
      title: `${e.title} 副本`,
      titleEn: e.titleEn ? `${e.titleEn} copy` : e.titleEn,
    };
    setData((prev) => {
      if (!prev) return prev;
      const idx = prev.exhibits.findIndex((x) => x.id === e.id);
      const next = [...prev.exhibits];
      next.splice(idx + 1, 0, copy);
      return { ...prev, exhibits: next };
    });
    setSelectedId(copy.id);
    setDirty(true);
    setBanner(null);
  }, [data]);

  /* ---------------- 删除（纸墨确认弹层 P1-7） ---------------- */
  const deleteExhibit = useCallback(async (e: CmsExhibit) => {
    const ok = await confirm({
      title: '删除展品',
      message: `确定删除「${e.title}」（${e.id}）吗？删除后需保存才会生效。`,
      danger: true,
    });
    if (!ok || !data) return;
    setData((prev) => (prev ? { ...prev, exhibits: prev.exhibits.filter((x) => x.id !== e.id) } : prev));
    if (selectedId === e.id) setSelectedId(null);
    setDirty(true);
    setBanner(null);
  }, [confirm, data, selectedId]);

  /* ---------------- 新增 ---------------- */
  const addExhibit = useCallback(() => {
    if (!data) return;
    const zoneId = data.zones[0]?.id ?? '';
    const e = blankExhibit(zoneId);
    setData((prev) => (prev ? { ...prev, exhibits: [...prev.exhibits, e] } : prev));
    setSelectedId(e.id);
    setDirty(true);
    setBanner(null);
  }, [data]);

  /* ---------------- 预览闭环（P0-1） ---------------- */
  const previewInGallery = useCallback((id: string) => {
    if (dirty) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), data })); } catch { /* 忽略 */ }
    }
    sessionStorage.setItem('lumen.cmsPreview', id);
    navigate('/');
  }, [data, dirty, navigate]);

  /* ---------------- 摆位取坐标（P0-2） ---------------- */
  const grabPosition = useCallback(() => {
    if (!selected) return;
    const p = selected.position as [number, number, number] | undefined;
    const y = Array.isArray(p) && typeof p[1] === 'number' ? p[1] : 1.6;
    patchSelected({ position: [round2(playerRef.x), y, round2(playerRef.z)] });
    setBanner({ kind: 'info', text: '已取当前站位为展品坐标（Y 保持原值）。' });
  }, [patchSelected, selected]);

  const grabRotation = useCallback(() => {
    if (!selected) return;
    const deg = Math.round(((playerRef.yaw * 180) / Math.PI + 180) % 360);
    patchSelected({ rotationDeg: deg });
    setBanner({ kind: 'info', text: '已取当前朝向为展品朝向。' });
  }, [patchSelected, selected]);

  /* ---------------- 草稿恢复 / 丢弃 ---------------- */
  const restoreDraft = useCallback(() => {
    if (!draftInfo) return;
    setData(draftInfo.data);
    setDirty(true);
    setDraftInfo(null);
    setBanner({ kind: 'info', text: '已恢复未保存的草稿。' });
  }, [draftInfo]);

  const discardDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_KEY);
    setDraftInfo(null);
  }, []);

  /* ---------------- 分组列表（P1-6 + 搜索） ---------------- */
  const groups = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const match = (e: CmsExhibit) =>
      !q || [e.title, e.titleEn, e.id].some((v) => String(v ?? '').toLowerCase().includes(q));
    const out: { zone: CmsZone | null; items: CmsExhibit[] }[] = data.zones
      .map((z) => ({ zone: z, items: data.exhibits.filter((e) => e.zone === z.id && match(e)) }))
      .filter((g) => g.items.length > 0);
    const orphans = data.exhibits.filter((e) => !data.zones.some((z) => z.id === e.zone) && match(e));
    if (orphans.length > 0) out.push({ zone: null, items: orphans });
    return out;
  }, [data, query]);

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: 'var(--paper)' }}>
        <p className="text-sm text-[var(--stone)]" style={{ fontFamily: 'var(--font-serif-lumen, serif)' }}>正在载入展品数据…</p>
      </div>
    );
  }

  const persistenceChip = meta?.persistence === 'supabase'
    ? { icon: <Database size={12} />, text: '数据库持久化' }
    : meta?.persistence === 'unavailable'
      ? { icon: <TriangleAlert size={12} />, text: '数据库暂不可用·已回退文件' }
      : { icon: <HardDrive size={12} />, text: '文件持久化' };

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      {confirmNode}
      {gateOpen && <CmsGate onAuthed={onGateAuthed} onCancel={onGateCancel} />}

      {/* ---------- 顶栏 ---------- */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b px-5 py-3"
        style={{ background: 'var(--paper-dim)', borderColor: 'var(--line)' }}>
        <button
          onClick={() => navigate('/')}
          className="rounded-full border px-3 py-1.5 text-[12px] transition-colors hover:border-[var(--brass)] hover:text-[var(--brass)]"
          style={{ borderColor: 'var(--line)' }}
        >
          ← 返回展厅
        </button>
        <h1 className="text-[15px]" style={{ fontFamily: 'var(--font-serif-lumen, serif)' }}>策展工作台</h1>
        {dirty && <span className="flex items-center gap-1 text-[11px] text-[#a63d2f]">● 有未保存改动{draftInfo ? '（已自动暂存草稿）' : ''}</span>}
        <span className="ml-auto flex items-center gap-2">
          {missingEn.length > 0 && (
            <button
              onClick={() => selectExhibit(missingEn[0].id)}
              className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px]"
              style={{ borderColor: '#c9a227', color: '#8a6d1a' }}
              title="点击跳到第一件缺译展品"
            >
              <Languages size={12} /> {missingEn.length} 件缺英文文案
            </button>
          )}
          <span className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] text-[var(--stone)]" style={{ borderColor: 'var(--line)' }}>
            {persistenceChip.icon} {persistenceChip.text}
          </span>
          {authRequired && !getCmsToken() && (
            <button
              onClick={() => void ensureToken()}
              className="rounded-full border px-2.5 py-1 text-[11px] text-[var(--stone)] hover:border-[var(--brass)]"
              style={{ borderColor: 'var(--line)' }}
            >
              未验证口令
            </button>
          )}
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] transition-opacity disabled:opacity-50"
            style={{ background: 'var(--brass)', color: 'var(--paper)' }}
          >
            <Save size={13} /> {saving ? '保存中…' : '保存'}
          </button>
        </span>
      </header>

      {/* ---------- 提示条 ---------- */}
      <div className="space-y-2 px-5 pt-3">
        {draftInfo && (
          <div className="flex items-center gap-3 rounded-[12px] border px-4 py-2.5 text-[12.5px]"
            style={{ background: 'var(--paper-dim)', borderColor: '#c9a227' }}>
            <TriangleAlert size={14} className="shrink-0 text-[#8a6d1a]" />
            <span className="flex-1">检测到 {timeAgo(draftInfo.savedAt)} 的未保存草稿（{draftInfo.data.exhibits.length} 件展品）。</span>
            <button onClick={restoreDraft} className="rounded-full px-3 py-1 text-[12px]" style={{ background: 'var(--brass)', color: 'var(--paper)' }}>恢复草稿</button>
            <button onClick={discardDraft} className="rounded-full border px-3 py-1 text-[12px]" style={{ borderColor: 'var(--line)' }}>丢弃</button>
          </div>
        )}
        <AnimatePresence>
          {banner && (
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              className={`flex items-start gap-3 rounded-[12px] border px-4 py-2.5 text-[12.5px] ${banner.kind === 'error' ? 'text-[#a63d2f]' : banner.kind === 'success' ? 'text-[#3d6b35]' : 'text-[var(--ink)]'}`}
              style={{
                background: 'var(--paper-dim)',
                borderColor: banner.kind === 'error' ? '#a63d2f' : banner.kind === 'success' ? '#3d6b35' : 'var(--line)',
                whiteSpace: 'pre-wrap',
              }}
            >
              <span className="flex-1">{banner.text}</span>
              <button onClick={() => setBanner(null)} className="text-[var(--stone)] hover:text-[var(--ink)]"><X size={14} /></button>
            </motion.div>
          )}
        </AnimatePresence>
        {meta?.warning && (
          <div className="flex items-start gap-3 rounded-[12px] border px-4 py-2.5 text-[12.5px] text-[#8a6d1a]"
            style={{ background: 'var(--paper-dim)', borderColor: '#c9a227' }}>
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            <span className="flex-1">{meta.warning}</span>
          </div>
        )}
      </div>

      {/* ---------- 主体 ---------- */}
      <div className="flex flex-col gap-5 px-5 pb-10 pt-4 lg:flex-row">
        {/* 左侧：展品列表 */}
        <aside className="w-full shrink-0 lg:w-[330px]">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-full border px-3 py-1.5" style={{ borderColor: 'var(--line)' }}>
              <Search size={13} className="text-[var(--stone)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标题 / 编号"
                className="w-full bg-transparent text-[12.5px] outline-none"
              />
              {query && <button onClick={() => setQuery('')}><X size={12} className="text-[var(--stone)]" /></button>}
            </div>
            <button
              onClick={addExhibit}
              className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] hover:border-[var(--brass)] hover:text-[var(--brass)]"
              style={{ borderColor: 'var(--line)' }}
            >
              <Plus size={13} /> 新增
            </button>
          </div>

          <div className="space-y-3">
            {groups.map(({ zone, items }) => {
              const key = zone?.id ?? '__none';
              const isCollapsed = collapsed[key] ?? false;
              const groupErr = items.filter((e) => allErrors[e.id]).length;
              return (
                <div key={key} className="rounded-[14px] border" style={{ borderColor: 'var(--line)' }}>
                  <button
                    onClick={() => setCollapsed((prev) => ({ ...prev, [key]: !isCollapsed }))}
                    className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
                  >
                    <ChevronDown size={14} className={`text-[var(--stone)] transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                    <span className="text-[13px]" style={{ fontFamily: 'var(--font-serif-lumen, serif)' }}>
                      {zone ? (zone.name ?? zone.id) : '未分区'}
                    </span>
                    <span className="text-[11px] text-[var(--stone)]">{zone?.nameEn ? ` · ${zone.nameEn}` : ''}</span>
                    <span className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--stone)]">
                      {groupErr > 0 && <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: '#a63d2f', color: 'var(--paper)' }}>{groupErr} 错</span>}
                      {items.length} 件
                    </span>
                  </button>
                  {!isCollapsed && (
                    <ul className="space-y-1 px-2 pb-2">
                      {items.map((e) => {
                        const errs = allErrors[e.id];
                        const missing = !String(e.titleEn ?? '').trim() || !String(e.descriptionEn ?? '').trim();
                        const isSel = e.id === selectedId;
                        return (
                          <li key={e.id}>
                            <button
                              onClick={() => selectExhibit(e.id)}
                              className="group flex w-full items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-left transition-colors"
                              style={{
                                borderColor: isSel ? 'var(--brass)' : 'transparent',
                                background: isSel ? 'var(--paper-dim)' : 'transparent',
                              }}
                            >
                              {(() => {
                                const src = typeof e.poster === 'string' && e.poster ? e.poster
                                  : e.type === 'image' && typeof e.src === 'string' ? e.src : '';
                                return src
                                  ? <img src={src} alt="" className="h-[34px] w-[34px] shrink-0 rounded-[8px] border object-cover" style={{ borderColor: 'var(--line)' }} onError={(ev) => { (ev.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                                  : <TypeIcon type={String(e.type ?? '')} />;
                              })()}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12.5px]">{String(e.title ?? '未命名')}</span>
                                <span className="block truncate text-[10.5px] text-[var(--stone)]">{e.id}</span>
                              </span>
                              <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100" onClick={(ev) => ev.stopPropagation()}>
                                <button onClick={() => previewInGallery(e.id)} title="去展厅看"
                                  className="rounded-full border p-1 hover:border-[var(--brass)] hover:text-[var(--brass)]" style={{ borderColor: 'var(--line)' }}>
                                  <Eye size={12} />
                                </button>
                                <button onClick={() => cloneExhibit(e)} title="克隆"
                                  className="rounded-full border p-1 hover:border-[var(--brass)] hover:text-[var(--brass)]" style={{ borderColor: 'var(--line)' }}>
                                  <Copy size={12} />
                                </button>
                                <button onClick={() => void deleteExhibit(e)} title="删除"
                                  className="rounded-full border p-1 hover:border-[#a63d2f] hover:text-[#a63d2f]" style={{ borderColor: 'var(--line)' }}>
                                  <Trash2 size={12} />
                                </button>
                              </span>
                              <span className="flex shrink-0 items-center gap-1">
                                {errs && (
                                  <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: '#a63d2f', color: 'var(--paper)' }}
                                    title={Object.values(errs).join('\n')}>
                                    {Object.keys(errs).length}
                                  </span>
                                )}
                                {missing && (
                                  <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: '#c9a227', color: 'var(--paper)' }}
                                    title="缺英文标题或介绍">EN</span>
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
            {groups.length === 0 && (
              <p className="rounded-[12px] border border-dashed px-4 py-8 text-center text-[12px] text-[var(--stone)]" style={{ borderColor: 'var(--line)' }}>
                没有匹配的展品
              </p>
            )}
          </div>
        </aside>

        {/* 右侧：编辑表单 */}
        <section className="min-w-0 flex-1">
          {selected ? (
            <CmsForm
              exhibit={selected}
              zones={data.zones}
              errors={allErrors[selected.id] ?? {}}
              onPatch={patchSelected}
              onGrabPosition={grabPosition}
              onGrabRotation={grabRotation}
            />
          ) : (
            <div className="rounded-[16px] border border-dashed px-8 py-20 text-center" style={{ borderColor: 'var(--line)' }}>
              <p className="text-[13px] text-[var(--stone)]">从左侧选择一件展品开始编辑，或点「新增」创建展品。</p>
              <p className="mt-2 text-[11.5px] text-[var(--stone)]">悬停列表项可预览 / 克隆 / 删除；编辑会自动暂存草稿。</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
