import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import type { ClientRequest, IncomingMessage } from "node:http";

// 通过 Vite 开发服务器代理转发 OCR 请求，避免浏览器跨域(CORS)鉴权问题。
// 关键：转发前剥掉浏览器特征头（Origin/Referer/Sec-Fetch/Sec-Ch-Ua 等），
// 否则阿里云/火山的边缘防护会把"看起来像浏览器"的请求拒绝，即使 Key 有效也返回 invalid_api_key。
const BROWSER_HEADERS = [
  "origin",
  "referer",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-dest",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "cookie",
];

function fixupProxyReq(proxyReq: ClientRequest, req: IncomingMessage) {
  // 1) 把自定义鉴权头改写成标准 Authorization（浏览器端用 x-dashscope-auth 传，
  //    规避部分浏览器扩展/内置网络拦截篡改标准 Authorization 头导致的 401）。
  const customAuth = req.headers["x-dashscope-auth"];
  if (typeof customAuth === "string" && customAuth) {
    proxyReq.setHeader("authorization", customAuth);
    proxyReq.removeHeader("x-dashscope-auth");
  }
  // 2) 剥掉浏览器特征头，伪装成普通服务端请求。
  for (const h of BROWSER_HEADERS) {
    proxyReq.removeHeader(h);
  }
  proxyReq.setHeader("user-agent", "okhttp/4.9.0");
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeManifestIcons: false,
      manifest: false,
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: "/",
        globPatterns: ["**/*.{js,css,html,ico,png,svg,json,woff2}"],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: {
              cacheName: "delivery-note-images",
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/dashscope-proxy": {
        target: "https://dashscope.aliyuncs.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dashscope-proxy/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", fixupProxyReq);
        },
      },
      "/ark-proxy": {
        target: "https://ark.cn-beijing.volces.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ark-proxy/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", fixupProxyReq);
        },
      },
    },
  },
});
