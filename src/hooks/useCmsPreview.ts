/**
 * useCmsPreview.ts — 消费策展后台「去展厅看」的预览意图。
 * 策展人在 /cms 点击预览后跳回 /，本钩子在进入 explore 态时：
 * 瞬移到目标展品正面约 2.4m 处并自动打开介绍弹窗，构成「编辑 → 一键验收」闭环。
 *
 * 位置数学：展陈件绕 Y 旋转 rotY（面朝本地 +Z），世界朝向 n = (sin rotY, cos rotY)；
 * 观看位 = 展品位 + n * 2.4；玩家 yaw = rotY + π（面向展品）。
 */
import { useEffect } from 'react';
import { playerRef, useStore } from '@/state/store';

const PREVIEW_KEY = 'lumen.cmsPreview';

export function useCmsPreview() {
  const appState = useStore((s) => s.appState);
  const data = useStore((s) => s.data);

  useEffect(() => {
    if (appState !== 'explore') return;
    const id = sessionStorage.getItem(PREVIEW_KEY);
    if (!id) return;
    const exhibit = data?.exhibits.find((e) => e.id === id);
    sessionStorage.removeItem(PREVIEW_KEY);
    if (!exhibit) return;

    const [x, , z] = exhibit.position;
    const rotY = ((exhibit.rotationDeg ?? 0) * Math.PI) / 180;
    const nx = Math.sin(rotY);
    const nz = Math.cos(rotY);
    playerRef.x = x + nx * 2.4;
    playerRef.z = z + nz * 2.4;
    const face = rotY + Math.PI;
    playerRef.yaw = face;
    playerRef.camYaw = face;

    // 稍等一帧让相机接管后再开弹窗，避免同帧抖动
    const timer = window.setTimeout(() => {
      useStore.getState().openModal(exhibit.id);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [appState, data]);
}
