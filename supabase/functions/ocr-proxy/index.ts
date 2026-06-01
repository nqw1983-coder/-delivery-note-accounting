/**
 * OCR 服务端代理 Edge Function
 *
 * 职责:
 * 1. 把客户端的 OCR 请求(图片 + prompt)转发到云端 OCR 服务
 * 2. API Key 留在服务端环境变量,客户端永远拿不到
 * 3. 默认走腾讯云通用 OCR(每月 1000 次免费),失败/低置信度时 fallback 到阿里云 qwen-vl
 *
 * 环境变量(在 Supabase Dashboard → Edge Functions → Secrets 配置):
 * - TENCENT_SECRET_ID:    腾讯云 SecretId
 * - TENCENT_SECRET_KEY:   腾讯云 SecretKey
 * - ALIYUN_DASHSCOPE_KEY: 阿里云 DashScope (qwen-vl) API Key
 * - PRIMARY_PROVIDER:     "tencent" | "aliyun"(默认 "tencent")
 *
 * 部署(在项目根目录):
 *   supabase functions deploy ocr-proxy
 *
 * 本地测试:
 *   supabase functions serve ocr-proxy
 */

// @ts-expect-error - Deno global available in Supabase Edge runtime
const env = Deno.env;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

interface OcrRequest {
  /** base64 dataURL,客户端已压缩为 ≤200KB JPEG */
  imageDataUrl: string;
  /** 客户端构造的 prompt(含已知客户名单) */
  prompt: string;
  /** 客户端期望的模型(仅阿里云分支生效) */
  model?: string;
}

interface OcrResponse {
  /** 模型返回的原始 content 字符串(包含 JSON) */
  content: string;
  /** 实际使用的 provider */
  provider: "tencent" | "aliyun";
  /** 实际使用的模型 */
  model: string;
}

async function callAliyun(req: OcrRequest, apiKey: string): Promise<OcrResponse> {
  const model = (req.model || "qwen-vl-max").toLowerCase();
  const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "supabase-edge/ocr-proxy",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: req.imageDataUrl } },
            { type: "text", text: req.prompt },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 200,
    }),
  });

  if (!response.ok) {
    const txt = await response.text().catch(() => "");
    throw new Error(`aliyun ${response.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("aliyun: empty content");
  return { content, provider: "aliyun", model };
}

/**
 * 腾讯云通用文字识别(GeneralBasicOCR)
 * 注意:腾讯云用 TC3-HMAC-SHA256 签名,流程比 Bearer Key 复杂。
 * 实现要点:
 * 1. 参数 ImageBase64 = dataURL 去掉 `data:image/...;base64,` 前缀
 * 2. 签名算法见 https://cloud.tencent.com/document/api/866/33526
 * 3. 返回 TextDetections[].DetectedText 拼成纯文本,交给客户端的 prompt 处理
 *
 * 腾讯 OCR 只返回文字,不会按 prompt 输出 JSON。所以客户端需要把
 * "拼成的全文" 自己解析(或当 raw_ocr_text 存起来,让用户自己填表)。
 *
 * 简化策略:腾讯只做"试试看",失败/不准时自动转阿里云。
 */
async function callTencent(req: OcrRequest, secretId: string, secretKey: string): Promise<OcrResponse> {
  const imageBase64 = req.imageDataUrl.replace(/^data:image\/[^;]+;base64,/, "");

  const host = "ocr.tencentcloudapi.com";
  const service = "ocr";
  const action = "GeneralBasicOCR";
  const version = "2018-11-19";
  const region = "ap-shanghai";
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const payload = JSON.stringify({ ImageBase64: imageBase64 });
  const hashedPayload = await sha256Hex(payload);

  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, hashedPayload].join("\n");

  const algorithm = "TC3-HMAC-SHA256";
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonical = await sha256Hex(canonicalRequest);
  const stringToSign = [algorithm, timestamp, credentialScope, hashedCanonical].join("\n");

  const kDate = await hmacSha256(`TC3${secretKey}`, date);
  const kService = await hmacSha256Buf(kDate, service);
  const kSigning = await hmacSha256Buf(kService, "tc3_request");
  const signatureBuf = await hmacSha256Buf(kSigning, stringToSign);
  const signature = bufToHex(signatureBuf);
  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${host}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Host: host,
      Authorization: authorization,
      "X-TC-Action": action,
      "X-TC-Version": version,
      "X-TC-Region": region,
      "X-TC-Timestamp": String(timestamp),
    },
    body: payload,
  });

  if (!response.ok) {
    const txt = await response.text().catch(() => "");
    throw new Error(`tencent ${response.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await response.json()) as {
    Response?: {
      Error?: { Code: string; Message: string };
      TextDetections?: Array<{ DetectedText: string }>;
    };
  };
  if (json.Response?.Error) {
    throw new Error(`tencent error ${json.Response.Error.Code}: ${json.Response.Error.Message}`);
  }
  const lines = (json.Response?.TextDetections ?? []).map((t) => t.DetectedText).filter(Boolean);
  if (lines.length === 0) {
    throw new Error("tencent: empty text detections");
  }
  // 把腾讯返回的纯文本包装成"模型 content",客户端可走原有 extractJson(可能失败)
  // 失败时客户端走 fallback,所以这里返回"包含原始文本"即可
  const content = JSON.stringify({
    shop: "",
    month: 0,
    day: 0,
    amount: 0,
    remark: lines.join(" "),
    _raw_lines: lines,
  });
  return { content, provider: "tencent", model: "GeneralBasicOCR" };
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bufToHex(buf);
}

async function hmacSha256(key: string, text: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(text));
}

async function hmacSha256Buf(keyBuf: ArrayBuffer, text: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(text));
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// @ts-expect-error - Deno.serve available in Supabase Edge runtime
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }

  let req: OcrRequest;
  try {
    req = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  if (!req.imageDataUrl || !req.prompt) {
    return new Response(JSON.stringify({ error: "Missing imageDataUrl or prompt" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const tencentId = env.get("TENCENT_SECRET_ID");
  const tencentKey = env.get("TENCENT_SECRET_KEY");
  const aliyunKey = env.get("ALIYUN_DASHSCOPE_KEY");
  const primary = env.get("PRIMARY_PROVIDER") || "tencent";

  // 路由策略:primary 失败时 fallback 到另一个
  const tryProviders: Array<"tencent" | "aliyun"> =
    primary === "aliyun" ? ["aliyun", "tencent"] : ["tencent", "aliyun"];

  const errors: Record<string, string> = {};
  for (const provider of tryProviders) {
    try {
      let result: OcrResponse;
      if (provider === "tencent") {
        if (!tencentId || !tencentKey) {
          errors[provider] = "credentials not set";
          continue;
        }
        result = await callTencent(req, tencentId, tencentKey);
      } else {
        if (!aliyunKey) {
          errors[provider] = "credentials not set";
          continue;
        }
        result = await callAliyun(req, aliyunKey);
      }
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    } catch (err) {
      errors[provider] = err instanceof Error ? err.message : String(err);
      console.warn(`[ocr-proxy] ${provider} failed:`, errors[provider]);
    }
  }

  return new Response(JSON.stringify({ error: "All providers failed", errors, tried: tryProviders }), {
    status: 502,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
});
