/**
 * 管理员模式:URL 加 ?admin=1 进入,sessionStorage 保留状态。
 * 管理员可以使用 JSON 反向导入恢复、查看所有数据等高级功能。
 *
 * 这不是安全边界 — 任何懂浏览器的人都能开。
 * 真正的访问控制由 src/lib/auth.ts 的密码门负责。
 */

const ADMIN_KEY = "delivery-admin-mode";

export function isAdminMode(): boolean {
  if (typeof window === "undefined") return false;
  // URL 参数优先,会持久化到 session
  const params = new URLSearchParams(window.location.search);
  if (params.get("admin") === "1") {
    try {
      sessionStorage.setItem(ADMIN_KEY, "1");
    } catch {
      // ignore
    }
    return true;
  }
  if (params.get("admin") === "0") {
    try {
      sessionStorage.removeItem(ADMIN_KEY);
    } catch {
      // ignore
    }
    return false;
  }
  try {
    return sessionStorage.getItem(ADMIN_KEY) === "1";
  } catch {
    return false;
  }
}
