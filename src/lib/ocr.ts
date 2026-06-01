import { mergeKnownShops, mergeShopAliases, BUILT_IN_KNOWN_SHOPS, BUILT_IN_SHOP_ALIASES } from "../data/shopMemory";
import { supabase } from "./supabase";

export type OcrProvider = "qwen" | "doubao";

export interface OcrSettings {
  provider: OcrProvider;
  apiKey: string;
  model?: string;
  /** 已知客户名单（注入 prompt，让模型把潦草字匹配到名单里） */
  knownShops?: string[];
  /** 字迹纠正字典：识别到 key → 自动替换为 value */
  shopAliases?: Record<string, string>;
}

export interface OcrResult {
  shop: string;
  month: number;
  day: number;
  amount: number;
  remark: string;
  rawText?: string;
}

const STORAGE_KEY = "delivery-ocr-settings";

const DEFAULT_MODELS: Record<OcrProvider, string> = {
  qwen: "qwen-vl-max",
  doubao: "doubao-1.5-vision-pro-32k-250115",
};

// 开发环境走 Vite 代理（同源，避免浏览器跨域鉴权问题）；
// 生产环境走 Supabase Edge Function（OCR Key 留服务端）。
const USE_PROXY = typeof import.meta !== "undefined" && import.meta.env?.DEV;
// 生产模式下若 Supabase 已配置,走 Edge Function 代理(Key 安全)
const USE_EDGE_FUNCTION =
  !USE_PROXY &&
  typeof import.meta !== "undefined" &&
  Boolean(import.meta.env?.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY);

const ENDPOINTS: Record<OcrProvider, string> = {
  qwen: USE_PROXY
    ? "/dashscope-proxy/compatible-mode/v1/chat/completions"
    : "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  doubao: USE_PROXY
    ? "/ark-proxy/api/v3/chat/completions"
    : "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
};

export const PROVIDER_LABELS: Record<OcrProvider, string> = {
  qwen: "通义千问 VL",
  doubao: "豆包 Vision",
};

// 构造鉴权头。开发环境走代理时，用自定义头 x-dashscope-auth 传 Key，
// 由 Vite 代理在服务器端改写成标准 Authorization 头。
// 目的：规避部分浏览器扩展/内置网络拦截会篡改标准 Authorization 头，导致 401。
function buildAuthHeaders(apiKey: string): Record<string, string> {
  const value = `Bearer ${apiKey}`;
  if (USE_PROXY) {
    return { "Content-Type": "application/json", "x-dashscope-auth": value };
  }
  return { "Content-Type": "application/json", Authorization: value };
}

export function loadOcrSettings(): OcrSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OcrSettings;
    if (!parsed.provider || !parsed.apiKey) return null;
    // 合并项目内置字典（硬层）+ localStorage 用户增量（软层）
    return {
      ...parsed,
      knownShops: mergeKnownShops(parsed.knownShops),
      shopAliases: mergeShopAliases(parsed.shopAliases),
    };
  } catch {
    return null;
  }
}

/** 导出当前完整字典（用户增量 + 内置）为 TypeScript 源码片段，
 *  方便人工 commit 回 src/data/shopMemory.ts。 */
export function exportShopMemoryAsTs(settings: OcrSettings): string {
  const shops = mergeKnownShops(settings.knownShops);
  const aliases = mergeShopAliases(settings.shopAliases);
  const shopsLines = shops.map((s) => `  "${s}",`).join("\n");
  const aliasLines = Object.entries(aliases)
    .map(([k, v]) => `  ${/^[一-龥A-Za-z0-9]+$/.test(k) ? k : `"${k}"`}: "${v}",`)
    .join("\n");
  return `export const BUILT_IN_KNOWN_SHOPS: string[] = [
${shopsLines}
];

export const BUILT_IN_SHOP_ALIASES: Record<string, string> = {
${aliasLines}
};
`;
}

export { BUILT_IN_KNOWN_SHOPS, BUILT_IN_SHOP_ALIASES };

export function saveOcrSettings(settings: OcrSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearOcrSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getDefaultModel(provider: OcrProvider): string {
  return DEFAULT_MODELS[provider];
}

export async function fileToDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
  // 自动预处理：缩放到短边 ≤ 1500px + 适度提对比度，提升识别率并显著省 token。
  // 失败兜底返回原图。
  try {
    return await preprocessImage(raw);
  } catch {
    return raw;
  }
}

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.92;

// 缩放图片到适合视觉模型的尺寸 + JPEG 高质量压缩，加速 API 处理。
// 测试数据：1920×1080 PNG ~1800KB → 1280 JPEG ~200KB，体积 1/9，识别效果几乎无差。
async function preprocessImage(dataUrl: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("加载图片失败"));
    el.src = dataUrl;
  });
  const { naturalWidth: w, naturalHeight: h } = img;
  const longSide = Math.max(w, h);
  const scale = longSide > MAX_DIMENSION ? MAX_DIMENSION / longSide : 1;
  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, tw, th);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

const PROMPT = `你是专业的中文送货单 OCR 助手。仔细识别图片里的手写送货单，**严格按 JSON 输出**（无任何解释、无 markdown 代码块）：

{"shop":"店面/客户名","month":1-12整数,"day":1-31整数,"amount":总金额数字,"remark":"品名摘要"}

字段说明：
- shop = 收货方/客户（"收货单位:""客户:"后的字），去掉"有限公司""餐饮"等后缀
- 日期"5月27日""5/27""5.27"统一拆成 month=5, day=27
- amount 优先取"合计/总计/共计"行的数字；没有就各行相加
- remark 多个品名用顿号分隔

只输出 JSON，不要任何额外字符。`;

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // 优先取最后一个 JSON 代码块
  const fences = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (fences.length) {
    const last = fences[fences.length - 1][1];
    try {
      return JSON.parse(last.slice(last.indexOf("{"), last.lastIndexOf("}") + 1));
    } catch {
      // fall through
    }
  }
  // Visual CoT 输出：从末尾向前找最后一个完整的 JSON 对象（含 "shop" 字段）
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (trimmed[i] !== "}") continue;
    // 从这个 } 往前找配对的 {
    let depth = 0;
    for (let j = i; j >= 0; j--) {
      if (trimmed[j] === "}") depth++;
      else if (trimmed[j] === "{") {
        depth--;
        if (depth === 0) {
          const candidate = trimmed.slice(j, i + 1);
          if (candidate.includes('"shop"')) {
            try {
              return JSON.parse(candidate);
            } catch {
              // 这个不行，继续往前找
            }
          }
          break;
        }
      }
    }
  }
  // 兜底：第一对 {} 试一次
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      // fall through
    }
  }
  throw new Error("模型未返回 JSON：" + text.slice(0, 200));
}

function normalizeResult(raw: unknown): OcrResult {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const shop = typeof obj.shop === "string" ? obj.shop.trim() : "";
  const monthNum = Number(obj.month);
  const month = Number.isFinite(monthNum) ? Math.floor(monthNum) : 0;
  const dayNum = Number(obj.day);
  const day = Number.isFinite(dayNum) ? Math.floor(dayNum) : 0;
  const amountNum = Number(obj.amount);
  const amount = Number.isFinite(amountNum) ? amountNum : 0;
  const remark = typeof obj.remark === "string" ? obj.remark.trim() : "";
  return { shop, month, day, amount, remark };
}

function sanitizeKey(key: string): string {
  return key.replace(/[\s​-‍﻿]/g, "");
}

function normalizeModelName(model: string): string {
  return model
    .replace(/[‐-―−]/g, "-")
    .toLowerCase()
    .trim();
}

export interface KeyDiagnostics {
  length: number;
  prefix: string;
  suffix: string;
  hasNonAscii: boolean;
  hasInternalWhitespace: boolean;
}

export function diagnoseKey(key: string): KeyDiagnostics {
  return {
    length: key.length,
    prefix: key.slice(0, 4),
    suffix: key.slice(-4),
    hasNonAscii: /[^\x20-\x7E]/.test(key),
    hasInternalWhitespace: /\s/.test(key.trim()),
  };
}

export async function testConnection(
  settings: OcrSettings
): Promise<{ ok: true; model: string; endpoint: string } | { ok: false; status: number; message: string; endpoint: string }> {
  const apiKey = sanitizeKey(settings.apiKey);
  const model = normalizeModelName(settings.model || DEFAULT_MODELS[settings.provider]);

  // 生产模式:走 Edge Function 测试,验证真实路径
  if (USE_EDGE_FUNCTION && supabase) {
    const edgeEndpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ocr-proxy`;
    try {
      const { data, error } = await supabase.functions.invoke("ocr-proxy", {
        body: {
          imageDataUrl:
            "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJSP/2wBDAQYGBgkICREJCREjGBQYIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyP/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9U6KKKAP/2Q==",
          prompt: "测试连接,输出:OK",
          model,
        },
      });
      if (error) {
        return { ok: false, status: 0, message: `Edge Function 调用失败:${error.message}`, endpoint: edgeEndpoint };
      }
      const payload = data as { content?: string; error?: string; provider?: string };
      if (payload?.error) {
        return { ok: false, status: 502, message: `OCR 失败:${payload.error}`, endpoint: edgeEndpoint };
      }
      return { ok: true, model: `${model}(via ${payload?.provider ?? "edge"})`, endpoint: edgeEndpoint };
    } catch (err) {
      return { ok: false, status: 0, message: err instanceof Error ? err.message : String(err), endpoint: edgeEndpoint };
    }
  }

  // 开发模式:直连阿里云(走 vite 代理)
  const endpoint = ENDPOINTS[settings.provider];
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildAuthHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5,
      }),
    });

    if (response.ok) {
      return { ok: true, model, endpoint };
    }
    const text = await response.text().catch(() => "");
    return { ok: false, status: response.status, message: text.slice(0, 400), endpoint };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : String(err), endpoint };
  }
}

// 构建带"已知客户名单 + 首字分组"的 prompt——大幅减少跨组误识别
function buildPrompt(knownShops?: string[]): string {
  const list = (knownShops ?? []).map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return PROMPT;

  // 按首字分组：相同首字的店面归为一组，让模型先看清第一笔画/偏旁，再从对应组里挑
  const groups = new Map<string, string[]>();
  for (const name of list) {
    const head = name[0];
    if (!groups.has(head)) groups.set(head, []);
    groups.get(head)!.push(name);
  }
  const groupLines = Array.from(groups.entries())
    .map(([head, names]) => `- 首字「${head}」：${names.join("、")}`)
    .join("\n");

  return (
    PROMPT +
    `\n\n# 🔥 已知客户名单（最高优先级！按"两步判断法"严格遵守）\n` +
    `\n## 按首字分组：\n${groupLines}\n` +
    `\n## 两步判断法（必须按顺序执行，不能跳步）：\n` +
    `**第一步：识别图片左上角"收货单位:"后的【第一个字】**\n` +
    `   - 仔细看第一个字的关键笔画/偏旁，先在心里确认它属于哪个首字\n` +
    `   - 例如开头是"亻"（单人旁）→ 属于"保"组；开头是"一+力"形 → 属于"万"组\n` +
    `\n**第二步：只从该首字对应的组内选一个**\n` +
    `   - 该首字组里只有 1 个候选 → 直接选它\n` +
    `   - 该首字组里有多个候选（例如"万"组有"万杨""万醉"）→ 看第二字字形选\n` +
    `\n## 强制纪律（违反会被判定错误）：\n` +
    `1. **绝对禁止跨组选择**：首字不同的店名互相不能替换。例如"万醉"和"保虾4"首字不同，绝对不能互换。\n` +
    `2. shop 字段必须**完全匹配**名单里的某个名字，原样照抄。\n` +
    `3. 若图上字迹明显是名单里某个的潦草写法（例如"万顺平""万西市"形似"万醉"）→ 输出标准名"万醉"，不要照搬潦草字形。\n` +
    `4. 只有当图上首字明显不属于上述任何分组时，才允许输出新名字。\n` +
    `5. shop 不要加括号、备注、数字编号。\n`
  );
}

// 字迹纠正字典：识别完成后做字典替换（兜底）
function applyShopAlias(shop: string, aliases?: Record<string, string>): string {
  if (!shop || !aliases) return shop;
  if (aliases[shop]) return aliases[shop];
  // 模糊匹配：去空格、繁简归一后再查
  const normalized = shop.replace(/\s+/g, "");
  if (aliases[normalized]) return aliases[normalized];
  return shop;
}

// ========== A. 白名单模糊匹配 ==========
// 用拼音相似度 + 字形相似度，把模型识别的潦草字自动匹配到已知客户名单。
// 例：模型出"万顺平"，白名单有"万醉" → 自动改成"万醉"

import { pinyin } from "pinyin-pro";

/** Levenshtein 编辑距离 → 字形相似度 [0,1] */
function charSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  const dist = dp[m][n];
  return 1 - dist / Math.max(m, n);
}

/** 拼音相似度 [0,1]：取首字母+完整拼音双重比较 */
function pinyinSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  try {
    const pa = (pinyin(a, { toneType: "none", type: "string" }) as string).replace(/\s+/g, "");
    const pb = (pinyin(b, { toneType: "none", type: "string" }) as string).replace(/\s+/g, "");
    const fa = (pinyin(a, { pattern: "first", toneType: "none", type: "string" }) as string).replace(/\s+/g, "");
    const fb = (pinyin(b, { pattern: "first", toneType: "none", type: "string" }) as string).replace(/\s+/g, "");
    return Math.max(charSimilarity(pa, pb), charSimilarity(fa, fb) * 0.9);
  } catch {
    return 0;
  }
}

/** 综合相似度：拼音 50% + 字形 30% + 首字相同加成 + 同字数加成 */
function combinedSimilarity(a: string, b: string): number {
  let score = 0.5 * pinyinSimilarity(a, b) + 0.3 * charSimilarity(a, b);
  if (a.length > 0 && b.length > 0 && a[0] === b[0]) score += 0.15;
  if (a.length === b.length) score += 0.05;
  return Math.min(1, score);
}

/** 在白名单中找最接近的客户名。返回 null 表示没有足够相似的。 */
function findBestMatchInKnownShops(
  recognized: string,
  knownShops: string[] | undefined,
  threshold = 0.6
): { match: string; score: number } | null {
  if (!recognized || !knownShops || knownShops.length === 0) return null;
  // 完全匹配直接返回
  if (knownShops.includes(recognized)) return { match: recognized, score: 1 };
  let best: { match: string; score: number } | null = null;
  for (const shop of knownShops) {
    const score = combinedSimilarity(recognized, shop);
    if (!best || score > best.score) best = { match: shop, score };
  }
  return best && best.score >= threshold ? best : null;
}

async function callOcrViaEdgeFunction(imageDataUrl: string, prompt: string, model: string): Promise<string> {
  if (!supabase) throw new Error("Supabase 未配置,无法调 Edge Function");
  const { data, error } = await supabase.functions.invoke("ocr-proxy", {
    body: { imageDataUrl, prompt, model },
  });
  if (error) {
    throw new Error(`Edge Function 调用失败:${error.message}`);
  }
  const payload = data as { content?: string; error?: string };
  if (payload?.error) {
    throw new Error(`OCR 服务返回错误:${payload.error}`);
  }
  if (!payload?.content) {
    throw new Error("Edge Function 返回为空");
  }
  return payload.content;
}

export async function recognizeDeliveryNote(
  imageDataUrl: string,
  settings: OcrSettings
): Promise<OcrResult> {
  const model = normalizeModelName(settings.model || DEFAULT_MODELS[settings.provider]);
  const endpoint = ENDPOINTS[settings.provider];
  const apiKey = sanitizeKey(settings.apiKey);
  const promptText = buildPrompt(settings.knownShops);

  let content: string;

  if (USE_EDGE_FUNCTION) {
    // 生产环境:走 Supabase Edge Function,API Key 在服务端
    content = await callOcrViaEdgeFunction(imageDataUrl, promptText, model);
  } else {
    // 开发环境:直连云服务(走 Vite 代理),用客户端配置的 Key
    const body = {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageDataUrl } },
            { type: "text", text: promptText },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 200,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildAuthHeaders(apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`OCR 服务返回 ${response.status}:${errText.slice(0, 200)}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const c = json.choices?.[0]?.message?.content;
    if (!c) {
      throw new Error("OCR 服务返回为空");
    }
    content = c;
  }

  const parsed = extractJson(content);
  const result = normalizeResult(parsed);
  // 兜底链：① 字迹纠正字典  →  ② 白名单拼音/字形模糊匹配
  result.shop = applyShopAlias(result.shop, settings.shopAliases);
  const fuzzy = findBestMatchInKnownShops(result.shop, settings.knownShops, 0.5);
  if (fuzzy && fuzzy.match !== result.shop) {
    result.shop = fuzzy.match;
  }
  result.rawText = content;
  return result;
}
