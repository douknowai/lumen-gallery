/**
 * cms.ts — 策展后台 API 客户端
 *
 * 统一封装 /api/cms/* 与 AI 辅助端点的访问：
 * - 口令令牌存 sessionStorage（lumen.cmsToken），随 Authorization: Bearer 发送
 * - 保存失败（400/401）的结构化错误原样抛出，由页面映射到字段级提示
 */

export interface CmsExhibit {
  [key: string]: unknown;
  id: string;
}

export interface CmsZone {
  id: string;
  name?: string;
  nameEn?: string;
  [key: string]: unknown;
}

export interface CmsData {
  gallery?: Record<string, unknown>;
  zones: CmsZone[];
  exhibits: CmsExhibit[];
}

export interface CmsFetchMeta {
  persistence: 'file' | 'supabase' | 'unavailable';
  warning?: string;
}

const TOKEN_KEY = 'lumen.cmsToken';

export function getCmsToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setCmsToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* 忽略存储失败 */
  }
}

export function clearCmsToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 统一请求：附带令牌；非 2xx 抛出带 code/payload 的错误 */
async function cmsFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body) headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  const token = getCmsToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(path, { ...init, headers });
}

/** 读响应 JSON；失败时尽力解析错误体 */
async function parseMaybeError(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text().catch(() => '');
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return { error: text.slice(0, 200) };
  }
}

export class CmsApiError extends Error {
  code: number;
  payload: Record<string, unknown>;
  constructor(code: number, message: string, payload: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.payload = payload;
  }
}

async function expectOk(res: Response, fallbackMsg: string): Promise<Record<string, unknown>> {
  const data = await parseMaybeError(res);
  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : fallbackMsg;
    throw new CmsApiError(res.status, msg, data);
  }
  return data;
}

/* ---------------- 口令 ---------------- */

export async function fetchAuthStatus(): Promise<{ required: boolean }> {
  const res = await cmsFetch('/api/cms/auth-status');
  const data = await expectOk(res, '读取门禁状态失败');
  return { required: Boolean(data.required) };
}

export async function cmsLogin(passcode: string): Promise<string> {
  const res = await cmsFetch('/api/cms/auth', {
    method: 'POST',
    body: JSON.stringify({ passcode }),
  });
  const data = await expectOk(res, '口令校验失败');
  if (typeof data.token !== 'string' || !data.token) {
    throw new CmsApiError(res.status, '口令校验失败', data);
  }
  return data.token;
}

/* ---------------- 展品数据 ---------------- */

export async function fetchExhibits(): Promise<{ data: CmsData; meta: CmsFetchMeta }> {
  const res = await cmsFetch('/api/cms/exhibits');
  const raw = await expectOk(res, '读取展品配置失败');
  const body = (raw.gallery || raw.zones || raw.exhibits ? raw : (raw.data as Record<string, unknown> | undefined)) ?? {};
  const data: CmsData = {
    gallery: (body.gallery as Record<string, unknown>) ?? undefined,
    zones: (body.zones as CmsZone[]) ?? [],
    exhibits: (body.exhibits as CmsExhibit[]) ?? [],
  };
  const meta: CmsFetchMeta = {
    persistence: (raw.persistence as CmsFetchMeta['persistence']) ?? 'file',
    warning: typeof raw.warning === 'string' ? raw.warning : undefined,
  };
  return { data, meta };
}

export async function saveExhibits(
  exhibits: CmsExhibit[],
): Promise<{ count: number; warning?: string }> {
  const res = await cmsFetch('/api/cms/exhibits', {
    method: 'PUT',
    body: JSON.stringify({ exhibits }),
  });
  const data = await expectOk(res, '保存失败');
  if (data.success !== true && !('count' in data)) {
    throw new CmsApiError(res.status, '保存失败', data);
  }
  return {
    count: Number(data.count ?? 0),
    warning: typeof data.warning === 'string' ? data.warning : undefined,
  };
}

/* ---------------- 素材上传 ---------------- */

export async function uploadAsset(
  fileName: string,
  contentType: string,
  dataBase64: string,
): Promise<string> {
  const res = await cmsFetch('/api/cms/upload', {
    method: 'POST',
    body: JSON.stringify({ fileName, contentType, dataBase64 }),
  });
  const data = await expectOk(res, '素材上传失败');
  if (typeof data.url !== 'string' || !data.url) {
    throw new CmsApiError(res.status, '素材上传失败：服务未返回地址', data);
  }
  return data.url;
}

/* ---------------- AI 辅助 ---------------- */

export interface LoreDraftParams {
  title: string;
  titleEn?: string;
  description?: string;
  artist?: string;
  year?: string;
  medium?: string;
  lang?: 'zh' | 'en';
}

export async function fetchLoreDraft(params: LoreDraftParams): Promise<string> {
  const res = await cmsFetch('/api/ai/lore-draft', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  const data = await expectOk(res, '草稿生成失败');
  if (typeof data.text !== 'string' || !data.text) {
    throw new CmsApiError(res.status, '草稿生成失败：空结果', data);
  }
  return data.text;
}

export async function fetchNarration(exhibit: CmsExhibit): Promise<string> {
  const res = await cmsFetch('/api/ai/narrate', {
    method: 'POST',
    body: JSON.stringify({ exhibit }),
  });
  const data = await expectOk(res, '导览词生成失败');
  if (typeof data.text !== 'string' || !data.text) {
    throw new CmsApiError(res.status, '导览词生成失败：空结果', data);
  }
  return data.text;
}

/* ---------------- 文件读取辅助（上传用） ---------------- */

/** 读取本地文件为 base64（不含 data: 前缀） */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}
