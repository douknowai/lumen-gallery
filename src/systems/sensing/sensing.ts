/**
 * sensing.ts — 感知引擎（AGENT 自检测核心，纯逻辑无 React）。
 *
 * 设计原则（见 DESIGN.md「感知与主动导览」）：
 * - 行为信号为主（输入闲置 / 驻足 / 徘徊），视觉信号为辅；
 * - 摄像头是「消歧器」而非「触发器」：在看画不打扰、离场不打扰、疲劳不打扰；
 * - 所有视觉信号由 PresenceMonitor 本地推理后写入，画面绝不上传。
 */

/** 观众氛围（氛围级判断，只用于微调语气与频率，不做精确情绪识别） */
export type MoodState = 'neutral' | 'delighted' | 'confused' | 'drowsy';

/** 主动搭话的触发原因 */
export type NudgeReason = 'hesitate' | 'lost' | 'wander' | 'related';

/** 视觉信号（摄像头感知可用时的实时快照） */
export interface VisualSignal {
  /** 摄像头感知是否可用（已授权且模型加载成功） */
  available: boolean;
  /** 人脸在场（含 2s 宽限：短暂低头 / 遮挡不算离场） */
  presence: boolean;
  /** 注视屏幕（头部朝向大致正对画面） */
  attention: boolean;
  /** 疲劳（长时间闭眼） */
  drowsy: boolean;
  /** 氛围状态 */
  mood: MoodState;
}

/* ---------- 触发阈值（行为信号） ---------- */
export const SENSING = {
  /** 多久无输入视为「意图模糊」（explore 态无移动 / 无视角 / 无交互） */
  IDLE_AFTER_MS: 45_000,
  /** 在展品聚焦上驻足多久未打开弹窗视为「犹豫」 */
  FOCUS_DWELL_MS: 18_000,
  /** 徘徊判定的时间窗口 */
  WANDER_WINDOW_MS: 90_000,
  /** 窗口内聚焦切换几次视为「选择困难」 */
  WANDER_SWITCHES: 3,
  /** presence 翻 false 的宽限时长（短暂低头 / 遮挡不算离场） */
  ABSENCE_GRACE_MS: 2_000,
} as const;

/* ---------- 防打扰纪律（主动导览） ---------- */
export const PROACTIVE = {
  /** 触发一次后的冷却时长 */
  COOLDOWN_MS: 150_000,
  /** 单次参观主动搭话上限（观众打开导览面板即重置） */
  MAX_PER_SESSION: 3,
  /** 搭话条展示完成后的自动收起时长 */
  AUTO_DISMISS_MS: 25_000,
} as const;

/* ---------- 注视判定阈值（弧度，来自头部变换矩阵的粗略估计） ---------- */
export const ATTENTION = {
  YAW_MAX: 0.52, // ≈30°
  PITCH_MAX: 0.42, // ≈24°
} as const;

type PresenceListener = (present: boolean) => void;

/**
 * 感知引擎单例：
 * - 行为信号由输入监听 / store 订阅写入（recordInput / recordFocusChange）；
 * - 视觉信号由 PresenceMonitor 写入（setVisual），presence 翻转带宽限并广播事件；
 * - ProactiveNudge 每秒轮询做触发判定，ExhibitCall 订阅 presence 做离开暂停。
 */
class SensingEngine {
  private lastInputAt = Date.now();
  private focusStartedAt = 0;
  private focusSwitches: number[] = [];
  private rawPresence = false;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<PresenceListener>();
  visual: VisualSignal = { available: false, presence: false, attention: false, drowsy: false, mood: 'neutral' };

  /** 记录一次观众活跃输入（按键 / 点击 / 滚轮 / 触控 / 相机跟随的指针移动） */
  recordInput(): void {
    this.lastInputAt = Date.now();
  }

  /** 记录一次聚焦目标变化（驻足 / 徘徊信号） */
  recordFocusChange(): void {
    const now = Date.now();
    this.focusSwitches.push(now);
    if (this.focusSwitches.length > 32) this.focusSwitches.shift();
    this.focusStartedAt = now;
    this.lastInputAt = now;
  }

  /** 距上次输入的时长 */
  idleMs(now = Date.now()): number {
    return now - this.lastInputAt;
  }

  /** 当前聚焦上的驻足时长（未聚焦过返回 0） */
  focusDwellMs(now = Date.now()): number {
    return this.focusStartedAt > 0 ? now - this.focusStartedAt : 0;
  }

  /** 时间窗口内的聚焦切换次数（徘徊信号） */
  focusSwitchCountIn(windowMs: number, now = Date.now()): number {
    return this.focusSwitches.filter((t) => now - t <= windowMs).length;
  }

  /** 合并写入视觉信号；presence 变化走带宽限的翻转逻辑 */
  setVisual(patch: Partial<VisualSignal>): void {
    this.visual = { ...this.visual, ...patch };
    if (patch.presence !== undefined) this.applyPresence(patch.presence);
  }

  /** 订阅在场状态翻转（离场暂停播报 / 回归恢复） */
  onPresenceChange(cb: PresenceListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** 重置全部信号（组件卸载 / 感知关闭时） */
  reset(): void {
    if (this.presenceTimer) {
      clearTimeout(this.presenceTimer);
      this.presenceTimer = null;
    }
    this.rawPresence = false;
    this.visual = { available: false, presence: false, attention: false, drowsy: false, mood: 'neutral' };
  }

  private applyPresence(raw: boolean): void {
    if (raw) {
      this.rawPresence = true;
      if (this.presenceTimer) {
        clearTimeout(this.presenceTimer);
        this.presenceTimer = null;
      }
      if (!this.visual.presence) {
        this.visual.presence = true;
        this.notify(true);
      }
      return;
    }
    if (!this.rawPresence) return;
    this.rawPresence = false;
    // 宽限期：短暂低头 / 遮挡不算离场
    if (!this.presenceTimer) {
      this.presenceTimer = setTimeout(() => {
        this.presenceTimer = null;
        if (!this.rawPresence && this.visual.presence) {
          this.visual.presence = false;
          this.notify(false);
        }
      }, SENSING.ABSENCE_GRACE_MS);
    }
  }

  private notify(present: boolean): void {
    for (const cb of this.listeners) {
      try {
        cb(present);
      } catch {
        /* 监听器异常不互相影响 */
      }
    }
  }
}

export const sensing = new SensingEngine();

/* ------------------------------------------------------------------ */
/* 氛围 / 疲劳判定（纯逻辑，带滞回与持续时长约束）                        */
/* ------------------------------------------------------------------ */

export const MOOD = {
  SMILE_ON: 0.45,
  SMILE_OFF: 0.25,
  SMILE_HOLD_MS: 1_200,
  BROW_ON: 0.4,
  BROW_HOLD_MS: 2_500,
  BLINK_ON: 0.5,
  DROWSY_HOLD_MS: 1_600,
} as const;

export interface MoodInput {
  smile: number;
  blink: number;
  browDown: number;
  now: number;
}

/** 喂入 blendshape 分数序列，输出带持续约束的氛围 / 疲劳状态 */
export class MoodTracker {
  private smileSince = 0;
  private browSince = 0;
  private blinkSince = 0;

  update(input: MoodInput): { mood: MoodState; drowsy: boolean } {
    const { smile, blink, browDown, now } = input;

    // 疲劳：长时间闭眼
    if (blink >= MOOD.BLINK_ON) {
      if (this.blinkSince === 0) this.blinkSince = now;
    } else {
      this.blinkSince = 0;
    }
    const drowsy = this.blinkSince > 0 && now - this.blinkSince >= MOOD.DROWSY_HOLD_MS;

    // 愉悦：持续微笑（滞回：超过 ON 计时，跌破 OFF 清零）
    if (smile >= MOOD.SMILE_ON) {
      if (this.smileSince === 0) this.smileSince = now;
    } else if (smile < MOOD.SMILE_OFF) {
      this.smileSince = 0;
    }
    const delighted = this.smileSince > 0 && now - this.smileSince >= MOOD.SMILE_HOLD_MS;

    // 困惑：持续皱眉
    if (browDown >= MOOD.BROW_ON) {
      if (this.browSince === 0) this.browSince = now;
    } else {
      this.browSince = 0;
    }
    const confused = this.browSince > 0 && now - this.browSince >= MOOD.BROW_HOLD_MS;

    const mood: MoodState = drowsy ? 'drowsy' : delighted ? 'delighted' : confused ? 'confused' : 'neutral';
    return { mood, drowsy };
  }
}

/**
 * 从 MediaPipe 4x4 列主序头部变换矩阵粗略提取朝向（弧度）。
 * 用于「注视屏幕」的近似判定，误差由宽松阈值吸收。
 */
export function headPoseFromMatrix(m: ArrayLike<number>): { yaw: number; pitch: number } {
  const zx = m[8] ?? 0;
  const zy = m[9] ?? 0;
  const zz = m[10] ?? 1;
  const yaw = Math.atan2(zx, zz);
  const pitch = Math.atan2(zy, Math.hypot(zx, zz));
  return { yaw, pitch };
}
