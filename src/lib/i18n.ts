/**
 * i18n.ts — 轻量国际化字典（中 / 英）。
 * 采用扁平 key + 静态字典，避免引入重型 i18n 框架。
 * 展品正文（title/description）与展区名走 exhibits.json 已有的双语字段，由使用方自行取值；
 * 本模块只负责「界面文案」。
 */
import { useStore } from '@/state/store';

export type Lang = 'zh' | 'en';

const DICT: Record<string, { zh: string; en: string }> = {
  /* ---------- 顶栏 / 通用 ---------- */
  'nav.firstPerson': { zh: '切换第一人称（V）', en: 'Switch to first person (V)' },
  'nav.thirdPerson': { zh: '切换第三人称（V）', en: 'Switch to third person (V)' },
  'nav.settings': { zh: '设置', en: 'Settings' },
  'nav.aiOn': { zh: '开启 AI 语音讲解', en: 'Enable AI audio guide' },
  'nav.aiOff': { zh: '关闭 AI 语音讲解', en: 'Disable AI audio guide' },
  'nav.help': { zh: '帮助（H）', en: 'Help (H)' },
  'nav.fullscreen': { zh: '全屏（F）', en: 'Fullscreen (F)' },
  'nav.guide': { zh: '导览员', en: 'Guide' },

  /* ---------- 通话状态 ---------- */
  'call.listening': { zh: '正在聆听…', en: 'Listening…' },
  'call.recognizing': { zh: '正在识别语音…', en: 'Recognizing speech…' },
  'call.writing': { zh: '正在撰写讲解词…', en: 'Writing the script…' },
  'call.thinking': { zh: '正在思考…', en: 'Thinking…' },
  'call.speaking': { zh: '正在播报…', en: 'Speaking…' },
  'call.pushHint': { zh: '按住空格或上方按钮说话', en: 'Hold Space or the button to speak' },
  'call.vadOnHint': { zh: '免提聆听中，直接开口说话', en: 'Hands-free listening, just speak' },
  'call.vadOffHint': { zh: '免提已关闭，点击空格或上方按钮开启', en: 'Hands-free off, press Space or the button to enable' },
  'call.you': { zh: '你', en: 'You' },
  'call.pushMode': { zh: '按住说话（空格键或下方按钮）', en: 'Hold to talk (Space or the button)' },
  'call.vadMode': { zh: '免提自动聆听', en: 'Hands-free auto listen' },
  'call.pressToTalk': { zh: '按住说话（空格）', en: 'Hold to talk (Space)' },
  'call.expand': { zh: '展开对话', en: 'Expand' },
  'call.collapse': { zh: '折叠（边走动边对话）', en: 'Collapse (walk and talk)' },
  'call.hangup': { zh: '挂断通话', en: 'Hang up' },
  'call.toggleVadOn': { zh: '点击开启免提', en: 'Enable hands-free' },
  'call.toggleVadOff': { zh: '免提聆听中，点击关闭', en: 'Hands-free on, click to disable' },

  /* ---------- 展品弹窗 ---------- */
  'exhibit.listen': { zh: '听它的介绍', en: 'Hear its story' },
  'exhibit.listenAgain': { zh: '再听一遍介绍', en: 'Replay introduction' },
  'exhibit.viewFull': { zh: '查看大图', en: 'View full image' },
  'exhibit.close': { zh: '关闭', en: 'Close' },
  'exhibit.author': { zh: '作者', en: 'Artist' },
  'exhibit.year': { zh: '年代', en: 'Year' },
  'exhibit.medium': { zh: '媒材', en: 'Medium' },
  'exhibit.credit': { zh: '来源', en: 'Credit' },
  'exhibit.modelHint': { zh: '（本展品为三维陈列，可关闭弹窗后环绕展台观看。）', en: '(This is a 3D display; close this panel and walk around the pedestal.)' },
  'exhibit.aiGuide': { zh: 'AI 语音讲解', en: 'AI Audio Guide' },
  'exhibit.zoom': { zh: '放大浏览', en: 'Zoom' },
  'exhibit.goVisit': { zh: '前往访问', en: 'Visit' },
  'exhibit.viewSource': { zh: '查看来源', en: 'View source' },
  'exhibit.license': { zh: '素材许可见 ASSETS-LICENSE', en: 'Credits: see ASSETS-LICENSE' },

  /* ---------- 导览员 ---------- */
  'guide.title': { zh: '导览员', en: 'Museum Guide' },
  'guide.subtitle': { zh: 'LUMEN 策展助手', en: 'LUMEN Curatorial Assistant' },
  'guide.placeholder': { zh: '问问导览员：哪件作品最值得看？', en: 'Ask the guide: what should I see first?' },
  'guide.send': { zh: '发送', en: 'Send' },
  'guide.greeting': { zh: '你好，我是 LUMEN 的导览员。想了解哪件作品，或是让我带你规划一条参观路线？', en: "Hi, I'm your LUMEN guide. Ask me about any work, or let me plan a route for you." },
  'guide.error': { zh: '导览对话失败，请重试', en: 'Guide request failed, please retry' },
  'guide.openChat': { zh: '打开导览员', en: 'Open guide' },
  'guide.close': { zh: '关闭导览员', en: 'Close guide' },
};

export function translate(lang: Lang, key: string): string {
  const entry = DICT[key];
  if (!entry) return key;
  return entry[lang];
}

/** 在组件内使用的 i18n hook（lang 与 setLang 来自全局 store） */
export function useI18n(): { lang: Lang; setLang: (l: Lang) => void; t: (key: string) => string } {
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  return { lang, setLang, t: (key: string) => translate(lang, key) };
}