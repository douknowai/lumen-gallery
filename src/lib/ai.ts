/**
 * ai.ts — 前端「AI 语音讲解」服务封装。
 * 统一走同源 /api/ai/* 接口（开发环境由 Vite 中间件转发给 api.mjs，生产由 server.js 处理）。
 * 对话采用 SSE 流式读取；narrate / tts / asr 为一次性 JSON 结果。
 */

/** 传给后端的展品事实底座（后端据此构造「展品人设」） */
export interface AiExhibitBrief {
  title: string;
  titleEn?: string;
  artist?: string;
  year?: string;
  medium?: string;
  description: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface NarrateResult {
  text: string;
  audioUri: string;
  audioSize?: number;
}

export interface TtsResult {
  audioUri: string;
  audioSize?: number;
}

export interface AsrResult {
  text: string;
  duration?: number;
}

const UID_KEY = 'lumen.uid';

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

/** 展品口播介绍：LLM 生成第一人称口播稿 → TTS 合成 */
export function narrate(exhibit: AiExhibitBrief): Promise<NarrateResult> {
  return postJson<NarrateResult>('/api/ai/narrate', { uid: getUid(), exhibit });
}

/** 文本转语音 */
export function tts(text: string): Promise<TtsResult> {
  return postJson<TtsResult>('/api/ai/tts', { uid: getUid(), text });
}

/** 语音识别（base64 音频） */
export function asr(base64Data: string): Promise<AsrResult> {
  return postJson<AsrResult>('/api/ai/asr', { uid: getUid(), base64Data });
}

/**
 * 与展品对话（LLM 流式，SSE）。
 * 每 yield 一段增量文本；后端发送 { type: 'done' } 后正常结束。
 */
export async function* chatStream(
  exhibit: AiExhibitBrief,
  message: string,
  history: ChatMessage[],
): AsyncGenerator<string> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: getUid(), exhibit, message, history }),
  });

  if (!res.ok || !res.body) {
    let msg = `对话失败（${res.status}）`;
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
    // 最后一段可能是半个事件，留在 buffer 等待下一个 chunk
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
        throw new Error(obj.message || '对话生成失败');
      } else if (obj.type === 'done') {
        return;
      }
    }
  }
}