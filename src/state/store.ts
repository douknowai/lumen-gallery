/**
 * store.ts — zustand 全局状态机（overlay.md §1）
 *
 * appState 流转：
 *   loading ──资源就绪──▶ ready ──点击「进入展厅」──▶ entering ──运镜完──▶ explore
 *   explore ⇄ help（H）   explore ⇄ modal（E/点击展品）   modal ⇄ lightbox（放大浏览）
 *
 * 约定：任何非 explore 状态，漫游输入挂起、Pointer Lock 退出、3D 降帧 30fps。
 * 高频瞬态（玩家坐标/朝向）不走 store，见 playerRef（每帧直写，Minimap 用 rAF 读取）。
 */
import { create } from 'zustand';
import type { ExhibitsData, Exhibit, CharactersData } from '@/config/schema';
import { DEFAULT_VOICE_ID } from '@/config/voices';

export type AppState =
  | 'loading'
  | 'ready'
  | 'entering'
  | 'explore'
  | 'modal'
  | 'lightbox'
  | 'help'
  | 'characters';
export type CameraMode = 'third' | 'first';
/** 通话输入模式：push=按住说话（空格/按钮）；vad=免提自动断句 */
export type CallMode = 'push' | 'vad';

/** 角色选择持久化 key */
const CHARACTER_STORAGE_KEY = 'lumen.character';
/** AI 语音讲解开关持久化 key */
const AI_STORAGE_KEY = 'lumen.ai';
/** 音色持久化 key */
const VOICE_STORAGE_KEY = 'lumen.voice';
/** 通话输入模式持久化 key */
const CALL_MODE_STORAGE_KEY = 'lumen.callmode';

/** 启动时读取本地记忆的角色 id（校验在数据加载后由 useGalleryLoader 完成） */
function readSavedCharacterId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(CHARACTER_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 启动时读取 AI 语音讲解开关（默认关闭） */
function readSavedAiEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(AI_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 启动时读取音色 id（默认小荷） */
function readSavedVoiceId(): string {
  if (typeof window === 'undefined') return DEFAULT_VOICE_ID;
  try {
    return window.localStorage.getItem(VOICE_STORAGE_KEY) || DEFAULT_VOICE_ID;
  } catch {
    return DEFAULT_VOICE_ID;
  }
}

/** 启动时读取通话输入模式（默认按住说话） */
function readSavedCallMode(): CallMode {
  if (typeof window === 'undefined') return 'push';
  try {
    return window.localStorage.getItem(CALL_MODE_STORAGE_KEY) === 'vad' ? 'vad' : 'push';
  } catch {
    return 'push';
  }
}

export interface Store {
  appState: AppState;
  /** 加载数据（校验通过后写入） */
  data: ExhibitsData | null;
  /** 角色配置数据（characters.json 校验通过后写入） */
  characters: CharactersData | null;
  /** 当前角色 id（持久化 localStorage） */
  characterId: string | null;
  /** 预载失败的角色 id（运行时隐藏该角色，不渲染身体） */
  failedCharacters: string[];
  /** 打开角色选择器前的状态（关闭时返回） */
  charactersFrom: AppState;
  /** 0-1 真实加载进度 */
  progress: number;
  /** 布展小贴士下标（LoadingOverlay 轮换） */
  cameraMode: CameraMode;
  /** 当前展区 id */
  zone: string;
  /** 已进入过的展区（首次进入触发区域揭示） */
  visitedZones: string[];
  /** 当前聚焦展品 id（null=无） */
  focusedId: string | null;
  /** 弹窗中的展品 id */
  modalId: string | null;
  /** 灯箱打开（图片源） */
  lightboxSrc: string | null;
  /** 指针锁定状态 */
  pointerLocked: boolean;
  /** 移动端设备 */
  isMobile: boolean;
  /** AI 语音讲解开关（持久化 localStorage，默认关闭） */
  aiEnabled: boolean;
  /** 当前音色 id（持久化 localStorage） */
  voiceId: string;
  /** 通话对象展品 id（null=未在通话；折叠后保留以支持边走动边对话） */
  callExhibitId: string | null;
  /** 通话面板是否折叠（折叠=回 explore 走动，字幕仍显示） */
  callCollapsed: boolean;
  /** 通话输入模式：按住说话 / 免提自动断句 */
  callMode: CallMode;
  /** 首次进入提示（横屏建议 / Esc 提示） */
  dismissedHints: string[];

  setData: (d: ExhibitsData) => void;
  setCharacters: (c: CharactersData) => void;
  /** 切换角色（持久化 localStorage，选择器点击即时生效） */
  setCharacterId: (id: string) => void;
  markCharacterFailed: (id: string) => void;
  /** 打开角色选择器（仅 explore / ready 可进入；记录返回态） */
  openCharacters: () => void;
  closeCharacters: () => void;
  toggleCharacters: () => void;
  setProgress: (p: number) => void;
  setReady: () => void;
  /** 点击「进入展厅」 */
  enterGallery: () => void;
  /** 入场运镜结束 */
  finishEntering: () => void;
  toggleCameraMode: () => void;
  setZone: (z: string) => void;
  setFocused: (id: string | null) => void;
  /** 打开展品弹窗 */
  openModal: (id: string) => void;
  closeModal: () => void;
  openLightbox: (src: string) => void;
  closeLightbox: () => void;
  openHelp: () => void;
  closeHelp: () => void;
  toggleHelp: () => void;
  setPointerLocked: (v: boolean) => void;
  setMobile: (v: boolean) => void;
  setAiEnabled: (v: boolean) => void;
  toggleAi: () => void;
  /** 设置音色（持久化） */
  setVoiceId: (id: string) => void;
  /** 设置通话输入模式（持久化） */
  setCallMode: (m: CallMode) => void;
  openCall: () => void;
  /** 折叠通话面板（关闭 modal 回 explore 走动，保留通话与字幕） */
  collapseCall: () => void;
  /** 展开通话面板（重新打开展品 modal） */
  expandCall: () => void;
  closeCall: () => void;
  dismissHint: (key: string) => void;
  /** Esc 逐层返回：lightbox > modal > help > explore */
  escape: () => void;
}

export const useStore = create<Store>((set, get) => ({
  appState: 'loading',
  data: null,
  characters: null,
  characterId: readSavedCharacterId(),
  failedCharacters: [],
  charactersFrom: 'explore',
  progress: 0,
  cameraMode: 'third',
  zone: 'hall',
  visitedZones: ['hall'],
  focusedId: null,
  modalId: null,
  lightboxSrc: null,
  pointerLocked: false,
  isMobile: false,
  aiEnabled: readSavedAiEnabled(),
  voiceId: readSavedVoiceId(),
  callExhibitId: null,
  callCollapsed: false,
  callMode: readSavedCallMode(),
  dismissedHints: [],

  setData: (d) => set({ data: d }),
  setCharacters: (c) => set({ characters: c }),
  setCharacterId: (id) => {
    // 持久化到 localStorage（下次启动直接恢复）
    try {
      window.localStorage.setItem(CHARACTER_STORAGE_KEY, id);
    } catch {
      /* 隐私模式等场景忽略 */
    }
    set({ characterId: id });
  },
  markCharacterFailed: (id) =>
    set((s) => (s.failedCharacters.includes(id) ? s : { failedCharacters: [...s.failedCharacters, id] })),
  openCharacters: () =>
    set((s) =>
      s.appState === 'explore' || s.appState === 'ready'
        ? { appState: 'characters', charactersFrom: s.appState }
        : s,
    ),
  closeCharacters: () => set((s) => ({ appState: s.charactersFrom })),
  toggleCharacters: () => {
    const s = get();
    if (s.appState === 'characters') s.closeCharacters();
    else s.openCharacters();
  },
  setProgress: (p) => set({ progress: Math.min(1, Math.max(0, p)) }),
  setReady: () => set({ appState: 'ready' }),
  enterGallery: () => set({ appState: 'entering' }),
  finishEntering: () => set({ appState: 'explore' }),
  toggleCameraMode: () => set((s) => ({ cameraMode: s.cameraMode === 'third' ? 'first' : 'third' })),
  setZone: (z) =>
    set((s) =>
      s.zone === z
        ? s
        : { zone: z, visitedZones: s.visitedZones.includes(z) ? s.visitedZones : [...s.visitedZones, z] },
    ),
  setFocused: (id) => set((s) => (s.focusedId === id ? s : { focusedId: id })),
  openModal: (id) => set({ appState: 'modal', modalId: id, focusedId: null }),
  closeModal: () =>
    set((s) => ({
      appState: 'explore',
      modalId: null,
      // 通话进行中时关闭弹窗 → 自动折叠（保留字幕，回 explore 走动）
      callCollapsed: s.callExhibitId ? true : s.callCollapsed,
    })),
  openLightbox: (src) => set({ appState: 'lightbox', lightboxSrc: src }),
  closeLightbox: () => set((s) => ({ appState: s.modalId ? 'modal' : 'explore', lightboxSrc: null })),
  openHelp: () => set({ appState: 'help' }),
  closeHelp: () => set({ appState: 'explore' }),
  toggleHelp: () => set((s) => ({ appState: s.appState === 'help' ? 'explore' : 'help' })),
  setPointerLocked: (v) => set({ pointerLocked: v }),
  setMobile: (v) => set({ isMobile: v }),
  setAiEnabled: (v) => {
    try {
      window.localStorage.setItem(AI_STORAGE_KEY, v ? '1' : '0');
    } catch {
      /* 隐私模式等场景忽略 */
    }
    set({ aiEnabled: v });
  },
  toggleAi: () => {
    const s = get();
    s.setAiEnabled(!s.aiEnabled);
  },
  setVoiceId: (id) => {
    try {
      window.localStorage.setItem(VOICE_STORAGE_KEY, id);
    } catch {
      /* 隐私模式等场景忽略 */
    }
    set({ voiceId: id });
  },
  setCallMode: (m) => {
    try {
      window.localStorage.setItem(CALL_MODE_STORAGE_KEY, m);
    } catch {
      /* 隐私模式等场景忽略 */
    }
    set({ callMode: m });
  },
  openCall: () =>
    set((s) => (s.appState === 'modal' && s.modalId ? { callExhibitId: s.modalId, callCollapsed: false } : s)),
  collapseCall: () => set({ callCollapsed: true, appState: 'explore', modalId: null }),
  expandCall: () =>
    set((s) => (s.callExhibitId ? { callCollapsed: false, appState: 'modal', modalId: s.callExhibitId } : s)),
  closeCall: () => set({ callExhibitId: null, callCollapsed: false, appState: 'explore', modalId: null }),
  dismissHint: (key) => set((s) => ({ dismissedHints: [...s.dismissedHints, key] })),
  escape: () => {
    const s = get();
    if (s.appState === 'lightbox') s.closeLightbox();
    else if (s.appState === 'modal' && s.callExhibitId && !s.callCollapsed) s.collapseCall();
    else if (s.appState === 'modal') s.closeModal();
    else if (s.appState === 'characters') s.closeCharacters();
    else if (s.appState === 'help') s.closeHelp();
    else if (s.callExhibitId && s.callCollapsed) s.closeCall();
  },
}));

/** 当前弹窗展品（便捷选择器） */
export function selectModalExhibit(s: Store): Exhibit | null {
  if (!s.data || !s.modalId) return null;
  return s.data.exhibits.find((e) => e.id === s.modalId) ?? null;
}

/** 当前通话对象展品（折叠后仍保留，供字幕/通话条使用） */
export function selectCallExhibit(s: Store): Exhibit | null {
  if (!s.data || !s.callExhibitId) return null;
  return s.data.exhibits.find((e) => e.id === s.callExhibitId) ?? null;
}

/**
 * 玩家瞬态（每帧直写，不经过 React）：
 * - x/z 世界坐标，yaw 朝向（弧度，0=面向+Z），speed 当前速率，running 是否疾跑
 * - camYaw/camPitch 相机朝向（相机 rig 直驱），camDistance 第三人称距离
 */
export const playerRef = {
  x: 0,
  z: 5.2,
  yaw: Math.PI, // 出生面向北（-Z）
  speed: 0,
  running: false,
  camYaw: Math.PI,
  camPitch: 0.12,
  camDistance: 3.4,
  /** 聚焦运镜请求：非 null 时相机 rig 执行 0.8s 运镜 */
  focusMove: null as null | { x: number; z: number; lookX: number; lookY: number; lookZ: number; t: number },
};
