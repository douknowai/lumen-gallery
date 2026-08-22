/**
 * api.mjs — LUMEN「AI 语音讲解」后端（纯 JS / ESM）
 *
 * 提供 5 个接口，全部基于 coze-coding-dev-sdk（仅允许在后端调用）：
 *   POST /api/ai/narrate  展品口播介绍（LLM 生成口播稿，图片类展品支持多模态看图）
 *   POST /api/ai/chat     与展品对话（LLM 流式，SSE 返回）
 *   POST /api/ai/guide    全馆导览员对话（LLM 流式，SSE 返回，注入展品清单）
 *   POST /api/ai/tts      文本转语音
 *   POST /api/ai/asr      语音识别（base64 或 URL）
 *
 * 开发环境：由 vite.config.ts 的 configureServer 中间件调用；
 * 生产环境：由 server.js 在静态服务前先分发到本模块。
 *
 * 设计约定：
 * - 展品信息由前端透传（title/artist/year/medium/description），后端零文件依赖；
 * - 展品「人格」通过 system prompt 注入，做到数据驱动、每件展品有自己的故事；
 * - 对话采用 SSE 流式（打字机体验），口播/ TTS / ASR 为一次性结果。
 */
import { LLMClient, TTSClient, ASRClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_UID = 'lumen-visitor';
const MAX_BODY_BYTES = 15 * 1024 * 1024; // 15MB（容纳录音 base64）

/* ------------------------------------------------------------------ */
/* 工具函数                                                             */
/* ------------------------------------------------------------------ */

/** 从 langchain 消息分片里安全提取文本（兼容 string 与 ContentPart[]） */
function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
  }
  return content ? String(content) : '';
}

/** 可做「看图讲解」的图片扩展名 */
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)$/i;

function imageMime(src) {
  if (/\.png$/i.test(src)) return 'image/png';
  if (/\.webp$/i.test(src)) return 'image/webp';
  if (/\.gif$/i.test(src)) return 'image/gif';
  return 'image/jpeg';
}

/**
 * 读取展品图片并转 base64 data URI，供多模态 LLM 看图。
 * 仅当 src 是图片、且文件真实存在于 public 目录时才返回，否则返回 null（回退纯文本讲解）。
 */
function loadExhibitImageDataUri(exhibit) {
  const src = exhibit?.src;
  if (typeof src !== 'string' || !IMAGE_EXT_RE.test(src)) return null;
  try {
    const rel = src.startsWith('/') ? src.slice(1) : src;
    const filePath = path.join(process.cwd(), 'public', rel);
    const buf = fs.readFileSync(filePath);
    if (buf.length === 0 || buf.length > 8 * 1024 * 1024) return null; // 超 8MB 放弃看图
    return `data:${imageMime(src)};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** 读取并解析 JSON 请求体（带大小上限与中文错误提示） */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] || 0);
    if (len > MAX_BODY_BYTES) {
      reject(new Error('请求体过大（录音文件超限）'));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大（录音文件超限）'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, status, message) {
  console.error('[LUMEN/AI]', message);
  sendJson(res, status, { error: message });
}

/** 写一行 SSE 数据 */
function writeSSE(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/** 将 Node 请求头规范化（string[] 展开为字符串），供 SDK 转发鉴权/上下文头 */
function normalizeHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return out;
}

/** 构造展品人设信息（注入 system prompt 的事实底座） */
function exhibitFacts(exhibit = {}) {
  const title = exhibit.title || '这件作品';
  return [
    `- 作品：《${title}》`,
    exhibit.titleEn ? `- 英文名：${exhibit.titleEn}` : '',
    exhibit.artist ? `- 艺术家：${exhibit.artist}` : '',
    exhibit.year ? `- 年代：${exhibit.year}` : '',
    exhibit.medium ? `- 媒材：${exhibit.medium}` : '',
    exhibit.description ? `- 简介：${exhibit.description}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function narrateSystemPrompt(exhibit) {
  return `你是一件艺术品的「化身」，正在美术馆里面对观众，用第一人称做一段有声语音导览。

请严格依据下面提供的事实信息，用自然、口语化、有温度的中文娓娓道来，像一位热情的讲解员，而不是念说明书。

要求：
1. 用第一人称「我」来讲述；
2. 时长约 20 秒，正文约 80～140 个汉字；
3. 不要分点罗列，不要出现「作者是」「年代是」这类标签式表达，把它们融入叙述；
4. 只输出导览词正文，不要任何前缀、标题、括号说明或 Markdown。

${exhibitFacts(exhibit)}`;
}

function chatSystemPrompt(exhibit) {
  return `你是一件艺术品的「化身」，正在美术馆里与一位观众进行语音对话。

请严格依据下面提供的事实信息作答，用简洁、自然、口语化的中文，像朋友聊天一样亲切。

规则：
1. 一般回答控制在 1～4 句话内（语音对话要简短）；
2. 优先依据「简介」中的事实，可适当补充艺术史常识，但不要编造具体数据或故事；
3. 观众让你介绍自己时，就用第一人称介绍这件作品；
4. 不要使用 Markdown、列表或表情符号，直接说人话。

${exhibitFacts(exhibit)}`;
}

/** 构造带历史的多轮 messages（保证至少含一条 user 消息） */
function buildMessages(systemPrompt, message, history) {
  const messages = [{ role: 'system', content: systemPrompt }];
  if (Array.isArray(history)) {
    for (const item of history) {
      const role = item && (item.role === 'assistant' || item.role === 'user') ? item.role : null;
      const content = item && typeof item.content === 'string' ? item.content : '';
      if (role && content) messages.push({ role, content });
    }
  }
  const text = typeof message === 'string' ? message : '';
  // 接口校验：messages 必须至少包含一条 user 消息；兜底避免空对话
  messages.push({ role: 'user', content: text || '请介绍一下自己' });
  return messages;
}

/** 把展品摘要列表整理成给导览员的事实底座（纯文本） */
function guideCatalogText(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) return '（暂无展品信息）';
  return catalog
    .map((it, i) => {
      if (!it) return '';
      const title = it.title || it.titleEn || '未命名作品';
      const artist = it.artist ? `，艺术家 ${it.artist}` : '';
      const zone = it.zoneName || it.zone || '';
      const type = it.type ? `，类型 ${it.type}` : '';
      const desc = it.description ? `，简介：${it.description}` : '';
      return `${i + 1}. 《${title}》${artist}${zone ? `，位于「${zone}」` : ''}${type}${desc}`;
    })
    .filter(Boolean)
    .join('\n');
}

function guideSystemPrompt(catalogText) {
  return `你是 LUMEN「流明」3D 虚拟美术馆的官方导览员，正在为观众提供参观帮助。

你可以回答观众关于展馆、展品、参观路线、推荐的问题，帮他们规划参观顺序、讲解展品亮点。

请严格依据下面提供的展品清单作答：
1. 只介绍清单里真实存在的作品，不要编造不存在的展品、艺术家或数据；
2. 观众问「最值得看什么」「怎么参观」「有哪些作品」时，给出 2～4 件推荐并说明理由；
3. 推荐展品时可以点名它所在的展厅，方便观众前往；
4. 用简洁、自然、口语化的中文，一般控制在 2～5 句话内；
5. 不要使用 Markdown 列表、编号或表情符号，直接说人话。

【展品清单】
${catalogText}`;
}

/* ------------------------------------------------------------------ */
/* 各接口实现                                                           */
/* ------------------------------------------------------------------ */

async function handleNarrate(req, res, body, customHeaders) {
  const exhibit = body?.exhibit || {};
  if (!exhibit.title && !exhibit.description) {
    return sendError(res, 400, '缺少展品信息');
  }

  const config = new Config();
  const llm = new LLMClient(config, customHeaders);

  // 看图讲解：展品若是图片，尝试读取本地文件转 data URI，让多模态模型真正「看到」作品
  const imageDataUri = loadExhibitImageDataUri(exhibit);
  const userContent = imageDataUri
    ? [
        { type: 'text', text: '请看着这幅作品，结合我提供的事实信息，用第一人称介绍你自己吧。' },
        { type: 'image_url', image_url: { url: imageDataUri, detail: 'high' } },
      ]
    : '请介绍一下你自己吧。';

  const messages = [
    { role: 'system', content: narrateSystemPrompt(exhibit) },
    { role: 'user', content: userContent },
  ];

  const llmConfig = { temperature: 0.75 };
  if (imageDataUri) llmConfig.model = 'doubao-seed-1-8-251228'; // 多模态模型

  const reply = await llm.invoke(messages, llmConfig);
  const text = (reply?.content || '').trim();

  if (!text) return sendError(res, 502, '口播稿生成失败');

  // 只返回口播稿；语音合成改由前端「分句分段 + 队列播放」完成（准流式，降低首播等待）
  sendJson(res, 200, { text, imageEnhanced: Boolean(imageDataUri) });
}

async function handleChat(req, res, body, customHeaders) {
  const exhibit = body?.exhibit || {};
  const message = body?.message;
  const history = body?.history;

  if (!message && !history?.length) {
    return sendError(res, 400, '缺少对话内容');
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const config = new Config();
  const llm = new LLMClient(config, customHeaders);

  try {
    const messages = buildMessages(chatSystemPrompt(exhibit), message, history);
    const stream = llm.stream(messages, { temperature: 0.7 });
    for await (const chunk of stream) {
      const text = extractText(chunk?.content);
      if (text) writeSSE(res, { type: 'delta', content: text });
    }
    writeSSE(res, { type: 'done' });
  } catch (err) {
    writeSSE(res, { type: 'error', message: err?.message || '对话生成失败' });
  } finally {
    res.end();
  }
}

async function handleTTS(req, res, body, customHeaders) {
  const text = body?.text;
  if (!text || typeof text !== 'string') {
    return sendError(res, 400, '缺少 text 文本');
  }

  const config = new Config();
  const tts = new TTSClient(config, customHeaders);

  const voice = await tts.synthesize({
    uid: body?.uid || DEFAULT_UID,
    text: text.slice(0, 2000),
    speaker: typeof body?.speaker === 'string' && body.speaker ? body.speaker : undefined,
  });

  if (!voice?.audioUri) return sendError(res, 502, '语音合成失败');
  sendJson(res, 200, { audioUri: voice.audioUri, audioSize: voice.audioSize });
}

async function handleASR(req, res, body, customHeaders) {
  const base64Data = body?.base64Data;
  const url = body?.url;

  if (!base64Data && !url) {
    return sendError(res, 400, '缺少 base64Data 或 url');
  }

  const config = new Config();
  const asr = new ASRClient(config, customHeaders);

  // 前端可能传 data URI，这里统一去掉前缀，仅保留纯 base64
  const pureBase64 =
    typeof base64Data === 'string' && base64Data.includes(',') ? base64Data.slice(base64Data.indexOf(',') + 1) : base64Data;

  const result = await asr.recognize(
    url ? { uid: body?.uid || DEFAULT_UID, url } : { uid: body?.uid || DEFAULT_UID, base64Data: pureBase64 },
  );

  if (!result || typeof result.text !== 'string') {
    return sendError(res, 502, '语音识别失败');
  }
  sendJson(res, 200, { text: result.text, duration: result.duration });
}

async function handleGuide(req, res, body, customHeaders) {
  const catalog = body?.catalog;
  const message = body?.message;
  const history = body?.history;

  if (!message && !history?.length) {
    return sendError(res, 400, '缺少对话内容');
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const config = new Config();
  const llm = new LLMClient(config, customHeaders);

  try {
    const messages = buildMessages(guideSystemPrompt(guideCatalogText(catalog)), message, history);
    const stream = llm.stream(messages, { temperature: 0.7 });
    for await (const chunk of stream) {
      const text = extractText(chunk?.content);
      if (text) writeSSE(res, { type: 'delta', content: text });
    }
    writeSSE(res, { type: 'done' });
  } catch (err) {
    writeSSE(res, { type: 'error', message: err?.message || '导览生成失败' });
  } finally {
    res.end();
  }
}

/* ------------------------------------------------------------------ */
/* 请求分发（被 server.js 与 vite 中间件共同调用）                       */
/* ------------------------------------------------------------------ */

export async function handleApiRequest(req, res) {
  // 依赖注入式错误捕获：每个 handle* 内部已捕获，这里兜底
  const method = req.method || 'GET';

  // CORS（开发环境虽同源，但保留对跨域调试的友好支持）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (method !== 'POST') {
    return sendError(res, 405, '仅支持 POST');
  }

  const pathname = new URL(req.url, 'http://localhost').pathname;
  let body = null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendError(res, 400, err?.message || '请求体解析失败');
  }

  const customHeaders = HeaderUtils.extractForwardHeaders(normalizeHeaders(req.headers));

  try {
    if (pathname.endsWith('/narrate')) return await handleNarrate(req, res, body, customHeaders);
    if (pathname.endsWith('/chat')) return await handleChat(req, res, body, customHeaders);
    if (pathname.endsWith('/tts')) return await handleTTS(req, res, body, customHeaders);
    if (pathname.endsWith('/asr')) return await handleASR(req, res, body, customHeaders);
    if (pathname.endsWith('/guide')) return await handleGuide(req, res, body, customHeaders);
    return sendError(res, 404, '未知的 AI 接口');
  } catch (err) {
    return sendError(res, 500, err?.message || 'AI 服务调用失败');
  }
}