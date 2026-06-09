import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PasswordGate } from "./components/PasswordGate";
import { isAuthenticated } from "./lib/auth";
import "./styles.css";

function Root() {
  const [authed, setAuthed] = useState(() => isAuthenticated());
  if (!authed) {
    return <PasswordGate onSuccess={() => setAuthed(true)} />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

// ===== 自动更新:每分钟查新版,新 Service Worker 接管时自动重载(不打断输入) =====
// 解决"手机一直跑旧缓存版本"——以后部署完,这边一两分钟内自己更新,无需删图标。
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.ready
    .then((reg) => {
      setInterval(() => reg.update().catch(() => {}), 60 * 1000);
    })
    .catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    // 正在输入时先不刷,避免打断
    const ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
    reloaded = true;
    window.location.reload();
  });
}

// 一键强制更新:注销所有 Service Worker + 清掉所有缓存 + 重载。供首页"版本号点击"调用。
(window as unknown as { __forceUpdate?: () => Promise<void> }).__forceUpdate = async () => {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* 忽略,照样重载 */
  } finally {
    window.location.reload();
  }
};
