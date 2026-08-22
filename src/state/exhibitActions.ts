/**
 * exhibitActions.ts — 展品打开动作（与 React 组件解耦，供 3D 点击、键盘、触屏等入口复用）。
 * openExhibit：请求观赏位运镜 + store 进入 modal 态；
 * markExhibitClick / elapsedSinceExhibitClick：记录最近展品点击时间，
 * 用于区分「点展品」与「点画布锁鼠标」，避免误触发指针锁定。
 */
import type { Exhibit } from '@/config/schema';
import { useStore, playerRef } from '@/state/store';
import { computeViewSpot } from '@/systems/interaction';

let lastExhibitClickAt = 0;

/** 记录一次展品点击（供防误触判定） */
export function markExhibitClick(): void {
  lastExhibitClickAt = Date.now();
}

/** 距最近一次展品点击是否已超过 ms 毫秒（用于区分「点展品」与「点画布锁鼠标」） */
export function elapsedSinceExhibitClick(ms: number): boolean {
  return Date.now() - lastExhibitClickAt > ms;
}

/** 打开展品详情：请求观赏位运镜 + store 进入 modal 态 */
export function openExhibit(e: Exhibit): void {
  const st = useStore.getState();
  if (st.appState !== 'explore') return;
  const spot = computeViewSpot(e, playerRef.x, playerRef.z);
  playerRef.focusMove = {
    x: spot.x,
    z: spot.z,
    lookX: e.position[0],
    lookY: e.position[1] || 1.2,
    lookZ: e.position[2],
    t: 0,
  };
  st.openModal(e.id);
}