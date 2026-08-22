/**
 * LoadingOverlay.tsx — 视图 1：加载 / 入场覆盖层（overlay.md §2）。
 * 暖白纯色"美术馆门厅"：字标、展览标题（字符级 stagger）、黄铜分隔线、
 * 真实进度条（0.3s 平滑）、布展小贴士轮换、「进入展厅」按钮。
 * 点击后整页 opacity→0 + blur 8px（0.6s easeInOutQuad）并触发入场运镜。
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, animate } from 'framer-motion';
import { useStore } from '@/state/store';

const TIPS_ZH = ['正在悬挂画作…', '正在调试射灯…', '正在擦拭展柜玻璃…', '正在摆放导览册…'];
const TIPS_EN = ['Hanging the paintings…', 'Focusing the spotlights…', 'Polishing the vitrine glass…', 'Arranging the brochures…'];
const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

/** 标题字符级 stagger（≤20 字符，间隔 .03s） */
function StaggerTitle({ text }: { text: string }) {
  return (
    <span className="inline-block">
      {Array.from(text).map((ch, i) => (
        <motion.span
          key={i}
          className="inline-block"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.36 + i * 0.03, duration: 0.55, ease: EASE }}
        >
          {ch === ' ' ? ' ' : ch}
        </motion.span>
      ))}
    </span>
  );
}

export default function LoadingOverlay() {
  const appState = useStore((s) => s.appState);
  const progress = useStore((s) => s.progress);
  const gallery = useStore((s) => s.data?.gallery);
  const lang = useStore((s) => s.lang);
  const tips = lang === 'zh' ? TIPS_ZH : TIPS_EN;
  const enterGallery = useStore((s) => s.enterGallery);
  const openCharacters = useStore((s) => s.openCharacters);
  const [smooth, setSmooth] = useState(0);
  const [tipIdx, setTipIdx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const pctRef = useRef<HTMLSpanElement>(null);

  // 进度 0.3s 平滑（禁止跳变）
  useEffect(() => {
    const controls = animate(smooth, progress, {
      duration: 0.3,
      ease: 'easeOut',
      onUpdate: (v) => {
        setSmooth(v);
        if (pctRef.current) pctRef.current.textContent = `${Math.round(v * 100)}%`;
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  // 小贴士 1.6s 轮换
  useEffect(() => {
    const t = setInterval(() => setTipIdx((i) => (i + 1) % tips.length), 1600);
    return () => clearInterval(t);
  }, [tips.length]);

  const ready = appState === 'ready';
  const onEnter = () => {
    if (!ready) return;
    setLeaving(true);
    enterGallery(); // store → entering，触发 IntroDolly
    // 淡出 0.6s 后卸载覆盖层
    setTimeout(() => setGone(true), 620);
  };

  // 自动进场：URL 带 ?enter=1 时，资源就绪后自动进入展厅（kiosk/嵌入式数字展厅场景）
  useEffect(() => {
    if (!ready) return;
    const auto = new URLSearchParams(window.location.search).get('enter');
    if (auto !== '1' && auto !== 'true') return;
    const t = setTimeout(onEnter, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // ready 之前若数据未就绪也保持加载页；entering 后淡出卸载
  const visible = !gone && (appState === 'loading' || appState === 'ready' || leaving);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="loading"
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center"
          style={{ background: 'var(--paper)', pointerEvents: leaving ? 'none' : 'auto' }}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, filter: 'blur(8px)' }}
          animate={{ opacity: leaving ? 0 : 1, filter: leaving ? 'blur(8px)' : 'blur(0px)' }}
          transition={{ duration: 0.6, ease: 'easeInOut' }}
        >
          {/* Logo */}
          <motion.img
            src="assets/logo.svg"
            alt="LUMEN"
            className="h-14 w-14"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: EASE }}
          />
          {/* 字标 */}
          <motion.div
            className="font-serif-lumen mt-4 text-[28px] font-medium tracking-[0.24em]"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.09, duration: 0.55, ease: EASE }}
          >
            LUMEN {lang === 'zh' && <span className="ml-1">流明</span>}
          </motion.div>
          {/* 展览标题 */}
          <h1 className="font-serif-lumen mt-10 text-[40px] font-medium leading-[1.15] tracking-[0.01em]">
            <StaggerTitle text={lang === 'zh' ? (gallery?.title ?? '经典的回响') : (gallery?.titleEn ?? 'Echoes of the Masters')} />
          </h1>
          <motion.div
            className="font-mono-lumen mt-2 text-[11px] font-medium uppercase tracking-[0.14em]"
            style={{ color: 'var(--stone)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.55 }}
          >
            {lang === 'zh' ? (gallery?.titleEn ?? 'Echoes of the Masters') : (gallery?.title ?? '经典的回响')}
          </motion.div>
          <motion.div
            className="mt-2 text-[12.5px]"
            style={{ color: 'var(--stone)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.58, duration: 0.55 }}
          >
            {lang === 'zh' ? (gallery?.subtitle ?? '公共领域艺术数字展') : (gallery?.subtitleEn ?? 'A Digital Exhibition of Public Domain Art')}
          </motion.div>
          {/* 黄铜分隔线 */}
          <motion.div
            className="my-6 h-px w-16"
            style={{ background: 'var(--brass)' }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.5, duration: 0.7, ease: EASE }}
          />
          {/* 进度区 / 进入按钮 */}
          <motion.div
            className="flex min-h-12 items-center"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.63, duration: 0.55, ease: EASE }}
          >
            {!ready ? (
              <div className="flex items-center gap-3">
                <div className="h-0.5 w-60 overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
                  <div
                    className="h-full rounded-full transition-[width] duration-300 ease-out"
                    style={{ width: `${smooth * 100}%`, background: 'var(--brass)' }}
                  />
                </div>
                <span ref={pctRef} className="font-mono-lumen w-9 text-[11px]" style={{ color: 'var(--stone)' }}>
                  0%
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <motion.button
                  type="button"
                  onClick={onEnter}
                  className="flex h-12 items-center rounded-[10px] px-8 text-sm font-semibold"
                  style={{ border: '1px solid var(--brass)', color: 'var(--ink)' }}
                  whileHover={{ background: 'var(--brass)', color: 'var(--paper)' }}
                  whileTap={{ scale: 0.96 }}
                  initial={{ boxShadow: '0 0 0 0 rgba(166,124,61,0)' }}
                  animate={{ boxShadow: ['0 0 0 0 rgba(166,124,61,.12)', '0 0 0 4px rgba(166,124,61,.12)', '0 0 0 0 rgba(166,124,61,0)'] }}
                  transition={{ duration: 0.6 }}
                >
                  {lang === 'zh' ? '进入展厅 →' : 'Enter the Gallery →'}
                </motion.button>
                {/* 设置入口（加载页先设置角色 / 音色 / 通话输入方式再进展厅） */}
                <button
                  type="button"
                  onClick={openCharacters}
                  className="text-[12.5px] underline-offset-2 hover:underline"
                  style={{ color: 'var(--stone)' }}
                >
                  {lang === 'zh' ? '设置 →' : 'Settings →'}
                </button>
              </div>
            )}
          </motion.div>
          {/* 布展小贴士 */}
          <div className="mt-4 h-5">
            <AnimatePresence mode="wait">
              {!ready && (
                <motion.div
                  key={tipIdx}
                  className="text-[12.5px]"
                  style={{ color: 'var(--stone)' }}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3 }}
                >
                  {tips[tipIdx]}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {/* 页脚 */}
          <motion.div
            className="absolute bottom-6 text-[12.5px]"
            style={{ color: 'var(--stone)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9, duration: 0.55 }}
          >
            {lang === 'zh' ? '桌面浏览器体验最佳 · 支持触屏 · 展品均来自公共领域开放馆藏' : 'Best on desktop · Touch enabled · All works from public domain open collections'}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
