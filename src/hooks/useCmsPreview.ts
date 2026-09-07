/**
 * useCmsPreview.ts — 消费策展后台「去展厅看」的预览意图。
 * 策展人在 /cms 点击预览后跳回 /，本钩子在进入 explore 态时：
 * 瞬移到目标展品正面约 2.4m 处并自动打开介绍弹窗，构成「编辑 → 一键验收」闭环。
 *
 * 预览意图（sessionStorage `lumen.cmsPreview`）支持两种格式：
 * - 新格式 `{ id, exhibit }`：携带编辑中的完整展品对象（未保存修改 / 新建展品也可预览）；
 *   会把该对象合并进展厅 store.data（id 存在则替换），弹窗 / 口播 / AI 讲解即读到最新内容
 * - 旧格式 纯 id 字符串：兼容处理，从已保存数据中查找
 *
 * 位置数学：展陈件绕 Y 旋转 rotY（面朝本地 +Z），世界朝向 n = (sin rotY, cos rotY)；
 * 观看位 = 展品位 + n * 2.4；玩家 yaw = rotY + π（面向展品）。
 */
import { useEffect } from 'react';
import { playerRef, useStore } from '@/state/store';
import { ExhibitSchema, type Exhibit } from '@/config/schema';

const PREVIEW_KEY = 'lumen.cmsPreview';

interface PreviewIntent {
  id: string;
  /** 编辑中的完整展品（未保存），优先于已保存版本 */
  exhibit?: Record<string, unknown>;
}

/** 读取并清除预览意图；解析失败返回 null，保证意图绝不残留 */
function readPreviewIntent(): PreviewIntent | null {
  try {
    const raw = sessionStorage.getItem(PREVIEW_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PREVIEW_KEY);
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'string') return { id: parsed };
    if (parsed && typeof parsed === 'object' && typeof (parsed as { id?: unknown }).id === 'string') {
      const obj = parsed as { id: string; exhibit?: unknown };
      return {
        id: obj.id,
        exhibit: obj.exhibit && typeof obj.exhibit === 'object' ? (obj.exhibit as Record<string, unknown>) : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function useCmsPreview() {
  const appState = useStore((s) => s.appState);
  const data = useStore((s) => s.data);

  useEffect(() => {
    if (appState !== 'explore') return;
    const intent = readPreviewIntent();
    if (!intent) return;

    const saved = data?.exhibits.find((e) => e.id === intent.id);
    const source = intent.exhibit ?? (saved as Record<string, unknown> | undefined);
    if (!source) return;

    // schema 规范化（补默认值）；失败（存在校验错误）时仍用原对象预览，位置字段另行防御
    const parsed = ExhibitSchema.safeParse(source);
    const exhibit = (parsed.success ? parsed.data : source) as unknown as Exhibit;

    const pos = Array.isArray(exhibit.position) ? exhibit.position : null;
    if (!pos || pos.length < 3 || pos.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return;
    const [x, , z] = pos;
    const rotY = ((typeof exhibit.rotationDeg === 'number' ? exhibit.rotationDeg : 0) * Math.PI) / 180;
    const nx = Math.sin(rotY);
    const nz = Math.cos(rotY);
    playerRef.x = x + nx * 2.4;
    playerRef.z = z + nz * 2.4;
    const face = rotY + Math.PI;
    playerRef.yaw = face;
    playerRef.camYaw = face;

    // 未保存内容注入展厅数据（弹窗 / 口播 / 聚焦均从 store.data 取）；注入改变 data → 本 effect 重跑，但意图已清除，不会循环
    if (intent.exhibit && data) {
      const exists = data.exhibits.some((e) => e.id === intent.id);
      const nextExhibits = exists
        ? data.exhibits.map((e) => (e.id === intent.id ? exhibit : e))
        : [...data.exhibits, exhibit];
      useStore.setState({ data: { ...data, exhibits: nextExhibits } });
    }

    // 稍等一帧让相机接管后再开弹窗，避免同帧抖动
    const timer = window.setTimeout(() => {
      useStore.getState().openModal(exhibit.id);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [appState, data]);
}
