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
  /** 英文定位标签 */
  labelEn?: string;
  /** 一句话描述音色气质 */
  desc: string;
  /** 英文气质描述 */
  descEn?: string;
}

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'zh_female_xiaohe_uranus_bigtts', name: '小荷', label: '女声', labelEn: 'Female', desc: '柔和自然，通用导览', descEn: 'Soft and natural, versatile guide' },
  { id: 'saturn_zh_female_cancan_tob', name: '灿灿', label: '女声', labelEn: 'Female', desc: '知性清晰，娓娓道来', descEn: 'Clear and articulate, unhurried' },
  { id: 'zh_male_m191_uranus_bigtts', name: '云舟', label: '男声', labelEn: 'Male', desc: '磁性沉稳，策展人气质', descEn: 'Rich and steady, a curator\u2019s presence' },
  { id: 'zh_male_ruyayichen_saturn_bigtts', name: '一尘', label: '男声', labelEn: 'Male', desc: '优雅舒缓，书卷气', descEn: 'Elegant and smooth, scholarly' },
];

export const DEFAULT_VOICE_ID = VOICE_OPTIONS[0].id;

/** 根据 id 反查音色（找不到时兜底默认） */
export function resolveVoice(id: string | null | undefined): VoiceOption {
  return VOICE_OPTIONS.find((v) => v.id === id) ?? VOICE_OPTIONS[0];
}