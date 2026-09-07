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
import {
  LLMClient,
  TTSClient,
  ASRClient,
  EmbeddingClient,
  Config,
  HeaderUtils,
  S3Storage,
} from 'coze-coding-dev-sdk';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

/* ------------------------------------------------------------------ */
/* RAG：展品语义检索（Embedding 向量 + 余弦相似度，替代全量清单硬塞 prompt）*/
/* ------------------------------------------------------------------ */

/** 把一件展品的多字段拼成可向量化的检索文档 */
function exhibitDocText(it) {
  if (!it) return '';
  const title = it.title || it.titleEn || '';
  const artist = it.artist ? `艺术家：${it.artist}` : '';
  const year = it.year ? `年代：${it.year}` : '';
  const medium = it.medium ? `媒介：${it.medium}` : '';
  const zone = it.zoneName || it.zone || '';
  const desc = it.description || it.lore || '';
  return [title, artist, year, medium, zone ? `展厅：${zone}` : '', desc]
    .filter(Boolean)
    .join('；');
}

/** 提取最近一条用户提问（作为检索 query） */
function latestUserQuery(message, history) {
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (Array.isArray(history)) {
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (h && h.role === 'user' && typeof h.content === 'string' && h.content.trim()) {
        return h.content.trim();
      }
    }
  }
  return '';
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 展品向量索引缓存：catalog 确定性 hash -> { docs, embeddings } */
const ragIndexCache = new Map();
const RAG_CACHE_MAX = 4;

function catalogHash(catalog) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify(Array.isArray(catalog) ? catalog : []))
    .digest('hex');
}

/** 并发为每件展品生成向量（失败项跳过），返回 { docs, embeddings } */
async function buildExhibitIndex(catalog, customHeaders) {
  const docs = (Array.isArray(catalog) ? catalog : [])
    .filter(Boolean)
    .map((it) => ({
      id: it.id || it.title || it.titleEn,
      title: it.title || it.titleEn || '未命名作品',
      zone: it.zoneName || it.zone || '',
      text: exhibitDocText(it),
    }))
    .filter((d) => d.text);

  const client = new EmbeddingClient(new Config(), customHeaders);
  const embeddings = await Promise.all(
    docs.map((d) => client.embedText(d.text).catch(() => null)),
  );
  return { docs, embeddings };
}

/** 语义检索：按相关度召回 top-k；embedding 失败返回 null（供调用方降级） */
async function retrieveExhibits(catalog, query, customHeaders, topK = 4) {
  try {
    const key = catalogHash(catalog);
    let idx = ragIndexCache.get(key);
    if (!idx) {
      idx = await buildExhibitIndex(catalog, customHeaders);
      ragIndexCache.set(key, idx);
      if (ragIndexCache.size > RAG_CACHE_MAX) {
        const oldest = ragIndexCache.keys().next().value;
        ragIndexCache.delete(oldest);
      }
    }
    const client = new EmbeddingClient(new Config(), customHeaders);
    const qv = await client.embedText(query);
    const scored = idx.docs
      .map((d, i) => ({ ...d, score: cosineSimilarity(qv, idx.embeddings[i]) }))
      .filter((d) => d.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  } catch (err) {
    return null;
  }
}

function visitedText(visited) {
  if (!Array.isArray(visited) || !visited.length) return '';
  const names = visited
    .filter(Boolean)
    .map((v) => v.title || v.id || '')
    .filter(Boolean);
  if (!names.length) return '';
  return `【这位观众已经看过的展品】\n${names.join('、')}`;
}

/** RAG 命中时的导览上下文：召回详情 + 轻量目录 + 观众足迹 */
function guideRichContext(retrieved, catalog, visited) {
  const parts = [];
  const catalogArr = Array.isArray(catalog) ? catalog : [];

  if (Array.isArray(retrieved) && retrieved.length) {
    parts.push(
      '【相关展品（按相关度排序，作为回答的主要事实依据）】\n' +
        retrieved
          .map((d, i) => {
            const src =
              catalogArr.find((c) => c && (c.id === d.id || c.title === d.title || c.titleEn === d.title)) ||
              {};
            const title = d.title || src.title || src.titleEn || '未命名作品';
            const artist = src.artist ? `，艺术家 ${src.artist}` : '';
            const zone = d.zone || src.zoneName || src.zone || '';
            const desc = src.description ? `，简介：${src.description}` : '';
            return `${i + 1}. 《${title}》${artist}${zone ? `，位于「${zone}」` : ''}${desc}`;
          })
          .join('\n'),
    );
  }

  if (catalogArr.length) {
    parts.push(
      '【全馆作品目录（仅用于回答“有哪些作品/怎么参观”类问题）】\n' +
        catalogArr
          .filter(Boolean)
          .map((it, i) => {
            const title = it.title || it.titleEn || '未命名作品';
            const zone = it.zoneName || it.zone || '';
            return `${i + 1}. 《${title}》${zone ? `（${zone}）` : ''}`;
          })
          .join('、'),
    );
  }

  const vtext = visitedText(visited);
  if (vtext) parts.push(vtext);

  return parts.join('\n\n');
}

function guideSystemPrompt(contextText) {
  return `你是 LUMEN「流明」3D 虚拟美术馆的官方导览员，正在为观众提供参观帮助。

你可以回答观众关于展馆、展品、参观路线、推荐的问题，帮他们规划参观顺序、讲解展品亮点。

请严格依据下面提供的展品资料作答：
1. 只介绍资料里真实存在的作品，不要编造不存在的展品、艺术家或数据；
2. 观众问「最值得看什么」「怎么参观」「有哪些作品」时，优先结合【相关展品】给出 2～4 件推荐并说明理由；
3. 推荐展品时可以点名它所在的展厅，方便观众前往；
4. 若观众问「这两件有什么关系」「风格怎么演变」这类跨作品问题，且资料中给出了多件相关作品，请说明它们在时代、主题、风格或流派上的关联与演变；
5. 若提供了「观众已经看过的展品」，可自然地呼应（例如“你刚才在《××》那边…”），但不要生硬复述；
6. 用简洁、自然、口语化的中文，一般控制在 2～5 句话内；
7. 不要使用 Markdown 列表、编号或表情符号，直接说人话。

${contextText}`;
}

/**
 * 主动搭话系统提示词（AGENT 自检测：proactive 模式）。
 * 场景：系统检测到观众驻足犹豫 / 迷失 / 徘徊 / 看得出神，由导览员主动发起一句简短搭话。
 * 与问答模式的最大差异：只输出一句话、必须具体、必须留钩子、绝不问「需要帮助吗」。
 */
function guideProactiveSystemPrompt(contextText, p) {
  const lang = p?.lang === 'en' ? 'en' : 'zh';
  const reason = typeof p?.reason === 'string' ? p.reason : 'lost';

  const reasonZh = {
    hesitate: '观众在某件作品前驻足良久，但还没有打开详细介绍',
    lost: '观众在展厅里停了下来，似乎不确定接下来看什么、去哪里',
    wander: '观众在几件作品之间来回犹豫，拿不定主意',
    related: '观众正在一件作品前看得出神',
  }[reason] || '观众在参观中出现了片刻停顿';
  const reasonEn = {
    hesitate: 'The visitor has been standing in front of a work for a while without opening its details',
    lost: 'The visitor has stopped and seems unsure what to see next or where to go',
    wander: 'The visitor keeps switching between several works, unable to decide',
    related: 'The visitor is gazing at a work with great interest',
  }[reason] || 'The visitor has paused during the tour';

  const linesZh = [
    p?.zoneName ? `当前所在展厅：「${p.zoneName}」` : '',
    p?.focusTitle
      ? `面前驻足的作品：《${p.focusTitle}》${p.dwellSeconds ? `（约 ${p.dwellSeconds} 秒）` : ''}`
      : '',
    Array.isArray(p?.nearbyTitles) && p.nearbyTitles.length ? `附近作品：《${p.nearbyTitles.join('》《')}》` : '',
    p?.mood === 'delighted' ? '观众看得津津有味，可顺势推荐一件相关联的作品。' : '',
    p?.mood === 'confused' ? '观众似乎有些困惑，语气更耐心，从一个简单的切入点讲起。' : '',
  ].filter(Boolean);

  const linesEn = [
    p?.zoneName ? `Current zone: "${p.zoneName}"` : '',
    p?.focusTitle
      ? `Work they are standing before: "${p.focusTitle}"${p.dwellSeconds ? ` (about ${p.dwellSeconds}s)` : ''}`
      : '',
    Array.isArray(p?.nearbyTitles) && p.nearbyTitles.length ? `Nearby works: ${p.nearbyTitles.join(', ')}` : '',
    p?.mood === 'delighted'
      ? 'The visitor seems delighted — naturally recommend one related work.'
      : '',
    p?.mood === 'confused'
      ? 'The visitor seems puzzled — be extra patient and start from one simple point.'
      : '',
  ].filter(Boolean);

  if (lang === 'en') {
    return `You are the official guide of LUMEN, a 3D virtual art museum.
Right now you are NOT answering a question — the sensing layer detected the visitor's state, and you are proactively starting a SHORT conversation.

[Visitor state]
- Why you are reaching out: ${reasonEn}
${linesEn.map((l) => '- ' + l).join('\n')}

Ground strictly on the material below (never invent works):
${contextText}

[Rules]
1. Output ONLY the greeting itself: one sentence, at most 25 words, no quotes, no prefix, no explanation;
2. Be specific: name the work or the zone and give one real reason to look closer;
3. Warm, calm curator tone, like a quiet whisper beside the visitor; NEVER say "Do you need help?";
4. End with a gentle hook the visitor can respond to (e.g. "Shall I tell you about...?").`;
  }

  return `你是 LUMEN「流明」3D 虚拟美术馆的官方导览员。
此刻你不是在回答观众提问，而是系统检测到观众的状态后，由你**主动发起一次简短搭话**。

【观众当下的状态】
- 主动搭话的原因：${reasonZh}
${linesZh.map((l) => '- ' + l).join('\n')}

请严格依据下面提供的展品资料作答（不要编造）：
${contextText}

【搭话要求】
1. 只输出搭话内容本身：一句话，不超过 40 个字，不要引号、前缀或任何多余说明；
2. 必须具体：点名作品或展厅，并给出一个真实的看点或推荐理由；
3. 语气自然、克制，像策展人在耳边轻声提醒，绝不说「需要帮助吗」这类空话；
4. 结尾留一个观众可以回应的钩子（例如「要不要我讲讲……？」）。`;
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

  const llmConfig = { temperature: 0.75, model: 'doubao-seed-2-0-lite-260215' };
  if (imageDataUri) llmConfig.model = 'doubao-seed-2-0-pro-260215'; // 多模态「看图」用旗舰模型

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
    const stream = llm.stream(messages, { model: 'doubao-seed-2-0-lite-260215', temperature: 0.7 });
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
  const visited = body?.visited;
  // AGENT 自检测：proactive 非空时为「主动搭话」模式（由系统检测观众状态后发起，无需观众提问）
  const proactive = body?.proactive && typeof body.proactive === 'object' ? body.proactive : null;

  if (!proactive && !message && !history?.length) {
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
    // RAG：语义召回相关展品；embedding 失败（null）时降级为全量清单
    // proactive 模式下用「驻足作品 + 附近作品 + 展厅」作为召回 query
    const query = proactive
      ? [
          proactive.focusTitle,
          ...(Array.isArray(proactive.nearbyTitles) ? proactive.nearbyTitles : []),
          proactive.zoneName,
        ]
          .filter((x) => typeof x === 'string' && x.trim())
          .join(' ')
      : latestUserQuery(message, history);
    let retrieved = null;
    if (query && Array.isArray(catalog) && catalog.length) {
      retrieved = await retrieveExhibits(catalog, query, customHeaders, 4);
    }
    const vtext = visitedText(visited);
    const contextText =
      retrieved !== null
        ? guideRichContext(retrieved, catalog, visited)
        : guideCatalogText(catalog) + (vtext ? '\n\n' + vtext : '');
    const systemPrompt = proactive
      ? guideProactiveSystemPrompt(contextText, proactive)
      : guideSystemPrompt(contextText);
    const userMessage = proactive
      ? proactive.lang === 'en'
        ? '(System-triggered proactive outreach. Generate the greeting line only.)'
        : '（系统检测到观众状态，请生成主动搭话内容。）'
      : message;
    const messages = buildMessages(systemPrompt, userMessage, history);
    const stream = llm.stream(messages, {
      model: 'doubao-seed-2-0-lite-260215',
      temperature: proactive ? 0.85 : 0.7, // 主动搭话更强调语气自然，温度略高
    });
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
/* 策展后台 CMS：读写展品数据（数据驱动，CRUD 落到 exhibits.json）        */
/* ------------------------------------------------------------------ */

const CMS_DATA_FILE = path.join(process.cwd(), 'public', 'data', 'exhibits.json');
const CMS_TMP_FILE = '/tmp/lumen-cms-exhibits.json';
// 与 src/config/schema.ts 的 WORLD_LIMIT 保持一致（前后端契约共享，避免越界展品被展厅静默跳过）
const WORLD_LIMIT = { x: 30, zMin: -19, zMax: 9 };

/** 读取展品数据（文件链）：生产优先读临时覆盖（编辑后立即预览），开发直接读仓库文件 */
function readExhibitsFile() {
  const isProd = process.env.COZE_PROJECT_ENV === 'PROD';
  const candidates = isProd ? [CMS_TMP_FILE, CMS_DATA_FILE] : [CMS_DATA_FILE];

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return { gallery: parsed.gallery ?? {}, zones: parsed.zones ?? [], exhibits: parsed.exhibits ?? [], file };
      }
    } catch {
      /* 文件缺失或 JSON 损坏则尝试下一个 */
    }
  }
  return { gallery: {}, zones: [], exhibits: [], file: null };
}

/* ---- 生产环境持久化：Supabase 快照（可用时写入跨部署存活；不可用时静默回退文件链） ---- */
let supabaseClientCache = null;
function getSupabase() {
  if (supabaseClientCache !== null) return supabaseClientCache;
  const url = process.env.COZE_SUPABASE_URL;
  const key = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY || process.env.COZE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    supabaseClientCache = false;
    return supabaseClientCache;
  }
  try {
    // 服务端持有 privileged key（service_role 优先），RLS 不放行 anon/authenticated
    supabaseClientCache = createSupabaseClient(url, key, { auth: { persistSession: false } });
  } catch (err) {
    console.warn('[CMS] Supabase 初始化失败，持久化回退文件模式：', err?.message || err);
    supabaseClientCache = false;
  }
  return supabaseClientCache;
}

async function readSupabasePayload() {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from('cms_snapshots').select('payload, updated_at').eq('id', 'exhibits').maybeSingle();
    if (error) throw error;
    return data?.payload ?? null;
  } catch (err) {
    console.warn('[CMS] Supabase 读取失败，回退文件链：', err?.message || err);
    return null;
  }
}

async function writeSupabasePayload(exhibits) {
  const supabase = getSupabase();
  if (!supabase) return false;
  try {
    const { error } = await supabase.from('cms_snapshots').upsert({ id: 'exhibits', payload: exhibits, updated_at: new Date().toISOString() });
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[CMS] Supabase 写入失败：', err?.message || err);
    return false;
  }
}

/** 展品读取总入口（异步）：生产环境 tmp → Supabase → 仓库文件；开发环境仅仓库文件 */
async function loadExhibits() {
  const isProd = process.env.COZE_PROJECT_ENV === 'PROD';
  const fromFile = readExhibitsFile();
  if (!isProd) return fromFile;
  if (fromFile.file === CMS_TMP_FILE && fromFile.file) return fromFile;
  const payload = await readSupabasePayload();
  if (Array.isArray(payload?.exhibits)) {
    return { gallery: payload.gallery ?? {}, zones: payload.zones ?? [], exhibits: payload.exhibits, file: 'supabase:cms_snapshots' };
  }
  return fromFile;
}

function supabasePersistenceReady() {
  return Boolean(getSupabase());
}

/** 写回展品数据（保留 gallery/zones，仅替换 exhibits）。生产环境：/tmp 即时生效 + Supabase 跨部署持久化 */
async function writeExhibitsFile(exhibits) {
  const isProd = process.env.COZE_PROJECT_ENV === 'PROD';
  const current = readExhibitsFile();
  const merged = {
    gallery: current.gallery ?? {},
    zones: current.zones ?? [],
    exhibits,
  };
  const payload = JSON.stringify(merged, null, 2) + '\n';

  if (isProd) {
    fs.writeFileSync(CMS_TMP_FILE, payload, 'utf8');
    const savedToSupabase = await writeSupabasePayload(merged);
    if (savedToSupabase) {
      return { persisted: true, warning: null, persistence: 'supabase' };
    }
    return {
      persisted: false,
      persistence: 'file',
      warning: '已临时写入（/tmp）并立即生效，但 Supabase 持久化不可用：重新部署后会丢失。请在 Supabase 中确认 cms_snapshots 表与凭据配置。',
    };
  }

  fs.writeFileSync(CMS_DATA_FILE, payload, 'utf8');
  return { persisted: true, warning: null, persistence: 'file' };
}

/** 展品数据契约校验（与 src/config/schema.ts 的 ExhibitSchema + parseExhibitsFile 容错规则对齐，作为写库前的契约守门） */
function validateExhibits(exhibits, zones) {
  const allowedTypes = ['image', 'video', 'model', 'text', 'link'];
  const allowedMounts = ['wall-frame', 'pedestal', 'vitrine', 'screen', 'panel'];
  const zoneIds = new Set((zones ?? []).map((z) => z.id));
  const seen = new Set();
  const errors = [];
  for (let i = 0; i < exhibits.length; i++) {
    const e = exhibits[i] ?? {};
    const tag = `第 ${i + 1} 件展品${e.id ? `（${e.id}）` : ''}`;
    if (typeof e.id !== 'string' || !e.id.trim()) {
      errors.push(`${tag}：缺少或非法的 id`);
      continue;
    }
    if (seen.has(e.id)) {
      errors.push(`${tag}：id「${e.id}」与其他展品重复`);
      continue;
    }
    seen.add(e.id);
    if (!allowedTypes.includes(e.type)) errors.push(`${tag}：type 非法（${e.type}）`);
    if (!allowedMounts.includes(e.mount)) errors.push(`${tag}：mount 非法（${e.mount}）`);
    if (typeof e.zone !== 'string' || !e.zone.trim()) {
      errors.push(`${tag}：缺少 zone`);
    } else if (!zoneIds.has(e.zone)) {
      errors.push(`${tag}：所属展区「${e.zone}」不存在`);
    }
    if (typeof e.title !== 'string' || !e.title.trim()) errors.push(`${tag}：title 不能为空`);
    if (typeof e.description !== 'string' || !e.description.trim()) errors.push(`${tag}：description 不能为空`);
    const pos = e.position;
    const posOk = Array.isArray(pos) && pos.length === 3 && pos.every((n) => typeof n === 'number' && Number.isFinite(n));
    if (!posOk) {
      errors.push(`${tag}：position 必须是 [x, y, z] 三个数字`);
    } else {
      const [px, , pz] = pos;
      if (Math.abs(px) > WORLD_LIMIT.x || pz < WORLD_LIMIT.zMin || pz > WORLD_LIMIT.zMax) {
        errors.push(`${tag}：坐标 (${px}, ${pz}) 越界（超出展厅边界）`);
      }
    }
    if ((e.type === 'image' || e.type === 'video') && !e.src) {
      errors.push(`${tag}：${e.type} 类型需要 src 素材路径`);
    }
    if (e.type === 'link' && !e.link) {
      errors.push(`${tag}：link 类型需要 link 地址`);
    }
  }
  return errors;
}

async function handleCmsRoute(req, res, method, pathname) {
  /* ---- 访问保护：配置 CMS_PASSCODE 后，写操作需携带口令换取的 Bearer 令牌 ---- */
  if (pathname === '/api/cms/auth-status') {
    return sendJson(res, 200, { success: true, required: cmsAuthRequired(), persistence: supabasePersistenceReady() ? 'supabase' : 'file' });
  }
  if (pathname === '/api/cms/auth' && method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendError(res, 400, err?.message || '请求体解析失败');
    }
    const passcode = String(body?.passcode ?? '');
    if (!cmsAuthRequired()) {
      return sendJson(res, 200, { success: true, token: '', required: false });
    }
    const expected = process.env.CMS_PASSCODE || '';
    const ok = passcode.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(passcode), Buffer.from(expected));
    if (!ok) return sendJson(res, 401, { success: false, error: '口令不正确' });
    return sendJson(res, 200, { success: true, token: cmsTokenFor(passcode), required: true });
  }

  if (pathname === '/api/cms/exhibits') {
    if (method === 'GET') {
      const { gallery, zones, exhibits, file } = await loadExhibits();
      return sendJson(res, 200, {
        success: true,
        gallery,
        zones,
        exhibits,
        file,
        persistence: supabasePersistenceReady() ? 'supabase' : 'file',
        authRequired: cmsAuthRequired(),
      });
    }
    if (method === 'PUT') {
      if (!cmsAuthorized(req)) {
        return sendJson(res, 401, { success: false, error: '未授权：请先输入访问口令', needAuth: true });
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendError(res, 400, err?.message || '请求体解析失败');
      }
      const exhibits = body?.exhibits;
      if (!Array.isArray(exhibits)) return sendError(res, 400, '缺少 exhibits 数组');
      const checkErrors = validateExhibits(exhibits, readExhibitsFile().zones);
      if (checkErrors.length > 0) {
        return sendJson(res, 400, { success: false, error: '展品数据未通过校验', errors: checkErrors });
      }
      try {
        const { persisted, warning, persistence } = await writeExhibitsFile(exhibits);
        return sendJson(res, 200, { success: true, persisted, warning, persistence, count: exhibits.length });
      } catch (err) {
        return sendError(res, 500, '写入失败：' + (err?.message || err));
      }
    }
  }

  /* ---- 素材上传（base64 JSON，避免 multipart 解析）→ 对象存储 → 同源稳定代理 URL ---- */
  if (pathname === '/api/cms/upload' && method === 'POST') {
    return handleCmsUpload(req, res);
  }

  /* ---- 素材访问代理：/api/cms/assets/<key> → 按需读取对象存储并回源 ---- */
  if (pathname.startsWith('/api/cms/assets/') && method === 'GET') {
    return handleCmsAsset(res, pathname);
  }

  return sendError(res, 404, '未知的 CMS 接口');
}

/* ---- CMS 口令保护实现：令牌 = sha256(口令 + 服务端盐)，无状态、不可反推 ---- */
function cmsAuthRequired() {
  return Boolean(process.env.CMS_PASSCODE);
}

function cmsTokenFor(passcode) {
  return crypto.createHash('sha256').update(`${passcode}::${process.env.CMS_PASSCODE}::lumen-cms`).digest('hex');
}

function cmsAuthorized(req) {
  if (!cmsAuthRequired()) return true;
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return false;
  const expected = cmsTokenFor(process.env.CMS_PASSCODE || '');
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

/* ---- 素材上传：写入对象存储，返回同源代理 URL（持久化存稳定路径，不存签名 URL） ---- */
const storage = new S3Storage();
const CMS_ASSET_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'image/gif': '.gif', 'image/avif': '.avif', 'image/svg+xml': '.svg',
  'video/mp4': '.mp4', 'video/webm': '.webm',
};
/* 上限 10MB（原始字节）。注意请求体走 base64 JSON，受全局 MAX_BODY_BYTES(15MB) 约束，
   10MB 原始文件 base64 后约 13.7MB，仍在 body 上限内；不要在未同步调高 MAX_BODY_BYTES 时放宽本值。 */
const CMS_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

async function handleCmsUpload(req, res) {
  try {
    if (!cmsAuthorized(req)) {
      return sendJson(res, 401, { success: false, error: '未授权：请先输入访问口令', needAuth: true });
    }
    const body = await readJsonBody(req);
    const mime = body?.contentType && Object.prototype.hasOwnProperty.call(CMS_ASSET_EXT, body.contentType)
      ? body.contentType
      : null;
    if (!mime) return sendError(res, 400, '不支持的文件类型（仅图片 / mp4 / webm）');
    if (typeof body?.dataBase64 !== 'string' || body.dataBase64.length === 0) {
      return sendError(res, 400, '缺少文件内容');
    }
    const raw = Buffer.from(body.dataBase64, 'base64');
    if (raw.length === 0) return sendError(res, 400, '文件内容为空');
    if (raw.length > CMS_MAX_UPLOAD_BYTES) return sendError(res, 413, '文件过大（上限 10MB）');

    const safeName = String(body?.fileName || 'asset')
      .split(/[\\/]/).pop()
      .replace(/[^\w.\-]+/g, '_')
      .slice(0, 60) || 'asset';
    const key = await storage.uploadFile({
      fileContent: raw,
      fileName: `cms-assets/${Date.now()}_${safeName}${CMS_ASSET_EXT[mime]}`,
      contentType: mime,
    });
    return sendJson(res, 200, { success: true, key, url: `/api/cms/assets/${encodeURIComponent(key)}` });
  } catch (err) {
    console.error('[CMS] upload failed:', err);
    return sendError(res, 502, '素材上传失败：' + (err?.message || err));
  }
}

async function handleCmsAsset(res, pathname) {
  const key = decodeURIComponent(pathname.replace(/^\/api\/cms\/assets\//, ''));
  if (!key || key.includes('..') || key.startsWith('/')) {
    return sendError(res, 400, '非法资源路径');
  }
  try {
    const buf = await storage.readFile({ fileKey: key });
    const ext = `.${(key.split('.').pop() || '').toLowerCase()}`;
    const mime = Object.keys(CMS_ASSET_EXT).find((m) => CMS_ASSET_EXT[m] === ext) || 'application/octet-stream';
    // SVG 等矢量素材可内嵌脚本：加 CSP sandbox 使直接打开时禁脚本/同源操作（<img> 引用不受影响），防存储型 XSS
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
    });
    res.end(buf);
  } catch (err) {
    return sendError(res, 404, '素材不存在或读取失败');
  }
}

/* ---- AI 辅助策展：lore 考据草稿生成（明确标注为草稿，供策展人改定后入库） ---- */
async function handleLoreDraft(req, res, body, customHeaders) {
  try {
    const title = String(body?.title || '').trim();
    if (!title) return sendError(res, 400, '缺少展品标题');
    const lang = body?.lang === 'en' ? 'en' : 'zh';
    const facts = [body?.description, body?.artist, body?.year, body?.medium]
      .filter((v) => typeof v === 'string' && v.trim())
      .join('\n');

    const prompt = lang === 'en'
      ? `You are the research curator of LUMEN, a 3D virtual art museum. Based ONLY on the verified facts below, draft a short background note (80-120 words) for the artwork "${title}". Cover: creation context, one stylistic hallmark, and one interesting anecdote or reception detail. Plain prose, no headings, no bullet points. Start with the literal line "[DRAFT — curator review required]" on its own first line. If facts are insufficient, say so explicitly and stay conservative — never invent specifics like dates or attributions.\n\nKnown facts:\n${facts || '(none beyond the title)'}`
      : `你是 LUMEN「流明」3D 虚拟美术馆的研究策展人。请仅依据下面给出的已核实信息，为作品《${title}》撰写一段背景考据草稿（80~120 字），内容覆盖：创作语境、一个风格特征、一件有趣的轶事或接受史细节。纯散文，不要标题、不要分点。第一行单独输出「【草稿 · 待策展人审校】」。若已知信息不足，请明确说明并保持保守——绝不编造具体年代、归属或事件。\n\n已知信息：\n${facts || '（仅有标题，无其他资料）'}`;

    const config = new Config();
    const llm = new LLMClient(config, customHeaders);
    const reply = await llm.invoke(
      [
        { role: 'system', content: prompt },
        { role: 'user', content: lang === 'en' ? `Draft the note for "${title}".` : `请为《${title}》生成考据草稿。` },
      ],
      { model: 'doubao-seed-2-0-lite-260215', temperature: 0.6 },
    );
    const text = String(reply?.content || '').trim();
    if (!text) return sendError(res, 502, '草稿生成结果为空');
    return sendJson(res, 200, { success: true, text });
  } catch (err) {
    console.error('[AI] lore-draft failed:', err);
    return sendError(res, 500, '草稿生成失败：' + (err?.message || err));
  }
}

/* ------------------------------------------------------------------ */
/* 请求分发（被 server.js 与 vite 中间件共同调用）                       */
/* ------------------------------------------------------------------ */

export async function handleApiRequest(req, res) {
  // 依赖注入式错误捕获：每个 handle* 内部已捕获，这里兜底
  const method = req.method || 'GET';

  // CORS（GET/POST/PUT；CMS 需要 GET 读 + PUT 写）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const pathname = new URL(req.url, 'http://localhost').pathname;

  // 策展后台 CMS：GET 读 / PUT 写（独立于 AI 的 POST-only 路由）
  if (pathname.startsWith('/api/cms/')) {
    return handleCmsRoute(req, res, method, pathname);
  }

  if (method !== 'POST') {
    return sendError(res, 405, '仅支持 POST');
  }

  let body = null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendError(res, 400, err?.message || '请求体解析失败');
  }

  const customHeaders = HeaderUtils.extractForwardHeaders(normalizeHeaders(req.headers));

  try {
    if (pathname.endsWith('/lore-draft')) return await handleLoreDraft(req, res, body, customHeaders);
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