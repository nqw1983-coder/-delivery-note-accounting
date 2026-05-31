/**
 * 简易密码门 — 仅做"防陌生人扫到网址"的轻量保护。
 *
 * 工作原理:
 * - 默认密码硬编码在代码里(可改),输入后用 Web Crypto SHA-256 比对哈希
 * - 通过后写 sessionStorage(关闭浏览器失效)
 * - 勾选"30 天免输"写 localStorage
 *
 * 安全级别:
 * - ❌ 不防"看了源码 JS 的人"(因为 anon key 公开,哈希也公开)
 * - ✅ 防"路过的陌生人偶然打开网址"(99% 场景)
 * - 真正的数据安全靠"不公开网址"+ Supabase RLS(若启用)
 *
 * 修改密码:
 * 1. 跑 `node scripts/hash-password.js <你的新密码>` 生成 SHA-256
 * 2. 把哈希粘到下面 PASSWORD_HASH 常量
 * 3. 提交 + 重新部署
 */

// SHA-256("songhuodan-2026") — 默认密码,务必上线前替换为自己的
const PASSWORD_HASH = "018d4d2e4c076cb4db65830f590e51c65ac29a9475240127854e65a04d3470c2";

const SESSION_KEY = "delivery-auth-session";
const REMEMBER_KEY = "delivery-auth-remember";
const REMEMBER_DAYS = 30;

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyPassword(input: string, remember: boolean): Promise<boolean> {
  const hash = await sha256(input);
  if (hash !== PASSWORD_HASH) return false;
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
    if (remember) {
      const expiresAt = Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000;
      localStorage.setItem(REMEMBER_KEY, String(expiresAt));
    }
  } catch {
    // ignore
  }
  return true;
}

export function isAuthenticated(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_KEY) === "1") return true;
    const remember = Number(localStorage.getItem(REMEMBER_KEY) ?? "0");
    if (remember && Date.now() < remember) {
      sessionStorage.setItem(SESSION_KEY, "1");
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function logout(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // ignore
  }
}
