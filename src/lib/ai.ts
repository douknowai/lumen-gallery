/**
 * ai.ts — 前端「AI 语音讲解」服务封装。
 * 统一走同源 /api/ai/* 接口（开发环境由 Vite 中间件转发给 api.mjs，生产由 server.js 处理）。
 * 对话采用 SSE 流式读取；narrate（口播稿）/ tts / asr 为一次性 JSON 结果。
 * 说明：TTS 无原生流式接口，本模块按「分句并发合成 → 队列顺序播放」实现准流式播出。
 */

/** 传给后端的展品事实底座（后端据此构造「展品人设」，图片类会触发多模态看图） */
export interface AiExhibitBrief {
  title: string;
  titleEn?: string;
  artist?: string;
  year?: string;
  medium?: string;
  description: string;
  /** 展品图片路径（如 /assets/artworks/xxx.jpg），供后端多模态看图讲解 */
  src?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** narrate 只返回口播稿；语音合成由前端分句分段完成 */
export interface NarrateResult {
  text: string;
  /** 后端是否真的调用了多模态「看图」来生成口播稿 */
  imageEnhanced?: boolean;
}

export interface TtsResult {
  audioUri: string;
  audioSize?: number;
}

/** 分句合成后的单个语音片段 */
export interface TtsSegment {
  text: string;
  audioUri: string;
}

export interface AsrResult {
  text: string;
  duration?: number;
}

/** 导览员事实底座：一份展品摘要（由前端从 exhibits.json 汇总） */
export interface GuideCatalogItem {
  id?: string;
  title?: string;
  titleEn?: string;
  artist?: string;
  type?: string;
  zone?: string;
  zoneName?: string;
  description?: string;
}

const UID_KEY = 'lumen.uid';
const CHAT_HISTORY_KEY = 'lumen.chat.history';
const GUIDE_HISTORY_KEY = 'lumen.guide.history';
const HISTORY_LIMIT = 40; // 每件展品 / 导览员最多持久化最近 40 条，控制 localStorage 体积

/** 稳定的匿名用户标识（SDK 的 uid 字段，用于区分不同游客） */
function getUid(): string {
  if (typeof window === 'undefined') return 'lumen-visitor';
  try {
    let id = window.localStorage.getItem(UID_KEY);
    if (!id) {
      id = `u${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      window.localStorage.setItem(UID_KEY, id);
    }
    return id;
  } catch {
    return 'lumen-visitor';
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    const msg = typeof data?.error === 'string' ? data.error : `请求失败（${res.status}）`;
    throw new Error(msg);
  }
  return data as T;
}

/** 统一的 SSE 流式读取器：每 yield 一段增量文本 */
async function* postSSEStream(path: string, body: unknown): AsyncGenerator<string> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    let msg = `请求失败（${res.status}）`;
    try {
      const data = await res.json();
      if (typeof data?.error === 'string') msg = data.error;
    } catch {
      /* 忽略非 JSON 错误体 */
    }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let obj: { type?: string; content?: string; message?: string };
      try {
        obj = JSON.parse(payload);
      } catch {
        continue;
      }
      if (obj.type === 'delta' && typeof obj.content === 'string') {
        yield obj.content;
      } else if (obj.type === 'error') {
        throw new Error(obj.message || '生成失败');
      } else if (obj.type === 'done') {
        return;
      }
    }
  }
}

/** 展品口播介绍：LLM 生成第一人称口播稿（图片类展品支持多模态看图） */
export function narrate(exhibit: AiExhibitBrief, speaker?: string): Promise<NarrateResult> {
  return postJson<NarrateResult>('/api/ai/narrate', { uid: getUid(), exhibit, speaker });
}

/** 文本转语音（可指定音色 speaker） */
export function tts(text: string, speaker?: string): Promise<TtsResult> {
  return postJson<TtsResult>('/api/ai/tts', { uid: getUid(), text, speaker });
}

/** 语音识别（base64 音频） */
export function asr(base64Data: string): Promise<AsrResult> {
  return postJson<AsrResult>('/api/ai/asr', { uid: getUid(), base64Data });
}

/** 与展品对话（LLM 流式，SSE） */
export async function* chatStream(
  exhibit: AiExhibitBrief,
  message: string,
  history: ChatMessage[],
): AsyncGenerator<string> {
  yield* postSSEStream('/api/ai/chat', { uid: getUid(), exhibit, message, history });
}

/** 与全馆导览员对话（LLM 流式，SSE，注入展品清单做事实底座） */
export async function* guideStream(
  catalog: GuideCatalogItem[],
  message: string,
  history: ChatMessage[],
): AsyncGenerator<string> {
  yield* postSSEStream('/api/ai/guide', { uid: getUid(), catalog, message, history });
}

/**
 * 按句末标点切分文本，用于「分句并行合成 → 队列播放」。
 * 覆盖中英文常见句末标点，忽略纯英文句号以免误伤小数/缩写。
 */
export function splitSentences(text: string): string[] {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = clean.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [clean];
  const out: string[] = [];
  for (const part of parts) {
    const s = part.trim();
    if (!s) continue;
    const last = out[out.length - 1];
    // 上一段过短时并入当前段，避免语音碎片化
    if (last && last.length < 4) out[out.length - 1] = last + s;
    else out.push(s);
  }
  return out;
}

/**
 * 准流式 TTS：把长文本分句后「并发」逐句合成，返回按原顺序的语音片段。
 * 播放层拿到第一段即可先播，后续段边播边就绪，显著降低首播等待。
 */
export async function ttsSegments(text: string, speaker?: string): Promise<TtsSegment[]> {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];
  const results = await Promise.allSettled(
    sentences.map(async (s) => {
      const { audioUri } = await tts(s, speaker);
      return { text: s, audioUri };
    }),
  );
  // 单句合成失败不影响其余片段：仅保留成功且 audioUri 有效的片段
  return results
    .filter((r): r is PromiseFulfilledResult<TtsSegment> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((r) => typeof r.audioUri === 'string' && r.audioUri.length > 0);
}

/** 读取某件展品的对话历史（若没有则返回空数组） */
export function loadChatHistory(exhibitId: string): ChatMessage[] {
  return loadHistoryMap(CHAT_HISTORY_KEY, exhibitId);
}

/** 持久化某件展品的对话历史 */
export function saveChatHistory(exhibitId: string, history: ChatMessage[]): void {
  saveHistoryMap(CHAT_HISTORY_KEY, exhibitId, history);
}

/** 读取导览员对话历史 */
export function loadGuideHistory(): ChatMessage[] {
  return loadHistoryList(GUIDE_HISTORY_KEY);
}

/** 持久化导览员对话历史 */
export function saveGuideHistory(history: ChatMessage[]): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = sanitizeHistory(history).slice(-HISTORY_LIMIT);
    window.localStorage.setItem(GUIDE_HISTORY_KEY, JSON.stringify(clean));
  } catch {
    /* 忽略存储异常 */
  }
}

function sanitizeHistory(history: ChatMessage[]): ChatMessage[] {
  if (!Array.isArray(history)) return [];
  return history.filter(
    (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
  );
}

function loadHistoryList(key: string): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    return sanitizeHistory(JSON.parse(raw));
  } catch {
    return [];
  }
}

function loadHistoryMap(key: string, id: string): ChatMessage[] {
  if (typeof window === 'undefined' || !id) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const map = JSON.parse(raw);
    return sanitizeHistory(map?.[id]);
  } catch {
    return [];
  }
}

function saveHistoryMap(key: string, id: string, history: ChatMessage[]): void {
  if (typeof window === 'undefined' || !id) return;
  try {
    const raw = window.localStorage.getItem(key);
    const map = raw ? JSON.parse(raw) : {};
    map[id] = sanitizeHistory(history).slice(-HISTORY_LIMIT);
    window.localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* 忽略存储异常 */
  }
}