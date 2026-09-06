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
} from 'coze-coding-dev-sdk';
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
    // RAG：语义召回相关展品；embedding 失败（null）时降级为全量清单
    const query = latestUserQuery(message, history);
    let retrieved = null;
    if (query && Array.isArray(catalog) && catalog.length) {
      retrieved = await retrieveExhibits(catalog, query, customHeaders, 4);
    }
    const vtext = visitedText(visited);
    const contextText =
      retrieved !== null
        ? guideRichContext(retrieved, catalog, visited)
        : guideCatalogText(catalog) + (vtext ? '\n\n' + vtext : '');
    const messages = buildMessages(guideSystemPrompt(contextText), message, history);
    const stream = llm.stream(messages, { model: 'doubao-seed-2-0-lite-260215', temperature: 0.7 });
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

/** 读取展品数据：生产优先读临时覆盖（编辑后立即预览），开发直接读仓库文件 */
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

/** 写回展品数据（保留 gallery/zones，仅替换 exhibits） */
function writeExhibitsFile(exhibits) {
  const isProd = process.env.COZE_PROJECT_ENV === 'PROD';
  const current = readExhibitsFile();
  const merged = {
    gallery: current.gallery ?? {},
    zones: current.zones ?? [],
    exhibits,
  };
  const payload = JSON.stringify(merged, null, 2) + '\n';

  if (isProd) {
    // 生产环境 public 只读：写入 /tmp 仅临时生效，重新部署后丢失
    fs.writeFileSync(CMS_TMP_FILE, payload, 'utf8');
    return { persisted: false, warning: '生产环境为临时写入（/tmp），重新部署后会丢失；请导出 JSON 并更新仓库 public/data/exhibits.json。' };
  }

  fs.writeFileSync(CMS_DATA_FILE, payload, 'utf8');
  return { persisted: true, warning: null };
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
  if (pathname === '/api/cms/exhibits') {
    if (method === 'GET') {
      const { gallery, zones, exhibits, file } = readExhibitsFile();
      return sendJson(res, 200, { success: true, gallery, zones, exhibits, file });
    }
    if (method === 'PUT') {
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
        const { persisted, warning } = writeExhibitsFile(exhibits);
        return sendJson(res, 200, { success: true, persisted, warning, count: exhibits.length });
      } catch (err) {
        return sendError(res, 500, '写入失败：' + (err?.message || err));
      }
    }
  }
  return sendError(res, 404, '未知的 CMS 接口');
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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