/**
 * voices.ts — AI 语音讲解的可选音色（对应后端 TTS SDK 的 speaker id）。
 * 音色来自 coze-coding-dev-sdk 官方音色表，这里精选 4 款贴合美术馆策展气质的中文音。
 */
export interface VoiceOption {
  /** TTS SDK 的 speaker id */
  id: string;
  /** 展示名 */
  name: string;
  /** 定位标签（男声/女声） */
  label: string;
  /** 一句话描述音色气质 */
  desc: string;
}

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'zh_female_xiaohe_uranus_bigtts', name: '小荷', label: '女声', desc: '柔和自然，通用导览' },
  { id: 'saturn_zh_female_cancan_tob', name: '灿灿', label: '女声', desc: '知性清晰，娓娓道来' },
  { id: 'zh_male_m191_uranus_bigtts', name: '云舟', label: '男声', desc: '磁性沉稳，策展人气质' },
  { id: 'zh_male_ruyayichen_saturn_bigtts', name: '一尘', label: '男声', desc: '优雅舒缓，书卷气' },
];

export const DEFAULT_VOICE_ID = VOICE_OPTIONS[0].id;

/** 根据 id 反查音色（找不到时兜底默认） */
export function resolveVoice(id: string | null | undefined): VoiceOption {
  return VOICE_OPTIONS.find((v) => v.id === id) ?? VOICE_OPTIONS[0];
}