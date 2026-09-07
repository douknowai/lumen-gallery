/**
 * ProactiveNudge.tsx — 主动导览触发器（AGENT 自检测的前端闭环）。
 *
 * 触发判定（每秒轮询一次，全部为必要条件的「与」）：
 * - 设置开启 + explore 自由参观（弹窗 / 通话 / 导览面板 / 帮助 / WebXR 均不触发）；
 * - 行为信号：驻足犹豫（聚焦一件展品超时未打开）/ 迷失（长时间无任何输入）/
 *   徘徊（窗口内多次在展品间切换）；
 * - 视觉消歧（感知可用时）：人不在场不打扰、走神看别处不打扰、疲劳不打扰；
 *   在看屏幕（可能在看画）时才允许触发；
 * - 防打扰：冷却 150s、单次参观上限 3 次、观众打开导览面板即重置额度。
 *
 * 搭话内容由 /api/ai/guide 的 proactive 模式生成（SSE 流式打字机），
 * 以底部字幕式轻提示呈现，附「回应 / 忽略」；完成后写入导览员对话历史，
 * 观众点「回应」打开面板即可无缝接续。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Compass } from 'lucide-react';
import { useStore, selectVisitedExhibits } from '@/state/store';
import {
  guideProactiveStream,
  type GuideCatalogItem,
  type GuideProactive,
} from '@/lib/ai';
import { sensing, PROACTIVE, SENSING, type NudgeReason } from '@/systems/sensing/sensing';
import { useI18n } from '@/lib/i18n';

interface NudgeState {
  text: string;
  streaming: boolean;
}

export default function ProactiveNudge() {
  const isMobile = useStore((s) => s.isMobile);
  const data = useStore((s) => s.data);
  const focusedId = useStore((s) => s.focusedId);
  const guideOpen = useStore((s) => s.guideOpen);
  const seedGuide = useStore((s) => s.seedGuide);
  const openGuide = useStore((s) => s.openGuide);
  const { t, lang } = useI18n();

  const [nudge, setNudge] = useState<NudgeState | null>(null);
  const cooldownUntilRef = useRef(0);
  const countRef = useRef(0);
  const showingRef = useRef(false);
  const genTokenRef = useRef(0);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const langRef = useRef(lang);

  /* 展品清单 → 导览员事实底座（与 GuideAssistant 同构） */
  const catalog = useMemo<GuideCatalogItem[]>(() => {
    if (!data) return [];
    const zoneNameOf = (id: string) => data.zones.find((z) => z.id === id)?.name ?? '';
    return data.exhibits.map((e) => ({
      id: e.id,
      title: e.title,
      titleEn: e.titleEn,
      artist: e.artist,
      year: e.year,
      medium: e.medium,
      type: e.type,
      zone: e.zone,
      zoneName: zoneNameOf(e.zone),
      description: e.description,
      lore: e.lore,
    }));
  }, [data]);
  const catalogRef = useRef<GuideCatalogItem[]>(catalog);

  /* ref 只能在渲染外更新：lang / catalog 变化后同步到 ref，供轮询闭包读取 */
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  useEffect(() => {
    catalogRef.current = catalog;
  }, [catalog]);

  const dismiss = useCallback(() => {
    genTokenRef.current += 1;
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    showingRef.current = false;
    setNudge(null);
  }, []);

  /* 观众打开导览面板 → 重置主动搭话额度（主动性起了作用，还权于观众） */
  const prevGuideOpen = useRef(guideOpen);
  useEffect(() => {
    if (guideOpen && !prevGuideOpen.current) countRef.current = 0;
    prevGuideOpen.current = guideOpen;
  }, [guideOpen]);

  /* 行为输入监听：键 / 点击 / 滚轮 / 触控一律视为活跃；
     指针移动仅在指针锁定（相机真正跟随）时计数，避免手搭在鼠标上抑制 idle 判定 */
  useEffect(() => {
    const onActive = () => sensing.recordInput();
    window.addEventListener('keydown', onActive);
    window.addEventListener('pointerdown', onActive);
    window.addEventListener('wheel', onActive, { passive: true });
    window.addEventListener('touchstart', onActive, { passive: true });
    window.addEventListener('touchmove', onActive, { passive: true });
    let lastMove = 0;
    const onMove = () => {
      const now = Date.now();
      if (now - lastMove < 400) return;
      lastMove = now;
      if (useStore.getState().pointerLocked) sensing.recordInput();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('keydown', onActive);
      window.removeEventListener('pointerdown', onActive);
      window.removeEventListener('wheel', onActive);
      window.removeEventListener('touchstart', onActive);
      window.removeEventListener('touchmove', onActive);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  /* 聚焦变化 → 驻足 / 徘徊信号 */
  useEffect(() => {
    if (focusedId) sensing.recordFocusChange();
  }, [focusedId]);

  /* 主轮询：触发判定 + 流式生成 */
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      const s = useStore.getState();
      if (!s.proactiveEnabled || showingRef.current) return;
      if (s.appState !== 'explore' || s.guideOpen || s.callExhibitId || s.xrActive) return;
      const now = Date.now();
      if (now < cooldownUntilRef.current) return;
      if (countRef.current >= PROACTIVE.MAX_PER_SESSION) return;

      const vis = sensing.visual;
      if (vis.drowsy) return; // 疲劳时不打扰
      if (vis.available && !vis.presence) return; // 人不在，搭话无意义

      const idleMs = sensing.idleMs(now);
      const dwellMs = sensing.focusDwellMs(now);
      let reason: NudgeReason | null = null;
      if (s.focusedId && dwellMs >= SENSING.FOCUS_DWELL_MS) {
        // 驻足犹豫：视觉可用且没看屏幕时克制（可能在看别的东西）
        if (!vis.available || vis.attention) {
          reason = vis.mood === 'delighted' ? 'related' : 'hesitate';
        }
      } else if (!s.focusedId && idleMs >= SENSING.IDLE_AFTER_MS) {
        if (!vis.available || vis.attention) {
          const wandered = sensing.focusSwitchCountIn(SENSING.WANDER_WINDOW_MS, now) >= SENSING.WANDER_SWITCHES;
          reason = wandered ? 'wander' : 'lost';
        }
      }
      if (!reason) return;

      // 触发：立即进入冷却与展示态（即使后续生成失败也不连续骚扰）
      countRef.current += 1;
      cooldownUntilRef.current = now + PROACTIVE.COOLDOWN_MS;
      showingRef.current = true;
      const token = ++genTokenRef.current;
      setNudge({ text: '', streaming: true });

      // 组装上下文（位置 / 驻足对象 / 附近作品 / 氛围）
      const zoneName = data?.zones.find((z) => z.id === s.zone)?.name;
      const focusExhibit = s.focusedId ? data?.exhibits.find((e) => e.id === s.focusedId) : null;
      const nearbyTitles = (data?.exhibits ?? [])
        .filter((e) => e.zone === s.zone && e.id !== focusExhibit?.id)
        .slice(0, 4)
        .map((e) => e.title);
      const payload: GuideProactive = {
        reason,
        zoneName,
        focusTitle: focusExhibit?.title,
        dwellSeconds: focusExhibit ? Math.round(dwellMs / 1000) : undefined,
        nearbyTitles: nearbyTitles.length ? nearbyTitles : undefined,
        mood: vis.mood === 'delighted' || vis.mood === 'confused' ? vis.mood : undefined,
        lang: langRef.current,
      };

      let full = '';
      try {
        for await (const delta of guideProactiveStream(payload, catalogRef.current, selectVisitedExhibits(s), langRef.current)) {
          if (!alive || token !== genTokenRef.current) return;
          full += delta;
          setNudge((prev) => (prev ? { ...prev, text: full } : prev));
        }
        if (!alive || token !== genTokenRef.current) return;
        const final = full.trim();
        if (final) seedGuide(final); // 写入导览员历史，面板打开即可接续
        setNudge({ text: final, streaming: false });
        dismissTimerRef.current = setTimeout(dismiss, PROACTIVE.AUTO_DISMISS_MS);
      } catch {
        // 生成失败静默收起，不打扰观众
        if (alive && token === genTokenRef.current) {
          showingRef.current = false;
          setNudge(null);
        }
      }
    };
    const timer = setInterval(() => void tick(), 1_000);
    return () => {
      alive = false;
      clearInterval(timer);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [data, dismiss, seedGuide]);

  const onReply = useCallback(() => {
    dismiss();
    openGuide();
  }, [dismiss, openGuide]);

  if (!nudge) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="proactive-nudge"
        className="pointer-events-auto fixed left-1/2 z-[44] -translate-x-1/2"
        style={{
          bottom: `calc(env(safe-area-inset-bottom) + ${isMobile ? '10rem' : '5.5rem'})`,
          width: isMobile ? 'calc(100vw - 24px)' : 'min(520px, calc(100vw - 3rem))',
        }}
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      >
        <div
          className="flex items-start gap-3 rounded-[14px] border px-4 py-3"
          style={{
            background: 'var(--paper)',
            borderColor: 'rgba(166,124,61,.45)',
            boxShadow: '0 20px 50px -18px rgba(20,18,15,.55)',
          }}
        >
          <div
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'var(--brass)', color: 'var(--paper)' }}
          >
            <Compass size={16} strokeWidth={1.5} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed" style={{ color: 'var(--ink)' }}>
              {nudge.text || '…'}
              {nudge.streaming && (
                <span
                  className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse align-middle"
                  style={{ background: 'var(--brass)' }}
                />
              )}
            </div>
            {!nudge.streaming && (
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onReply}
                  className="rounded-full px-3.5 py-1.5 text-[12px] transition-opacity hover:opacity-85"
                  style={{ background: 'var(--brass)', color: 'var(--paper)' }}
                >
                  {t('nudge.reply')}
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded-full border px-3.5 py-1.5 text-[12px] transition-colors hover:bg-[var(--paper-dim)]"
                  style={{ borderColor: 'var(--line)', color: 'var(--stone)' }}
                >
                  {t('nudge.dismiss')}
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
