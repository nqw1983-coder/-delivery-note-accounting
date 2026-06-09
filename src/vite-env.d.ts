/// <reference types="vite/client" />

// 构建时注入的版本号(MMDD-HHMM 北京时间),见 vite.config.ts 的 define
declare const __BUILD_ID__: string;
