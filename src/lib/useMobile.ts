import { useEffect, useState } from "react";

/**
 * 检测是否为 Apple 触屏设备(iPhone / iPad,含新版伪装成 Macintosh 的 iPad)。
 * Mac 桌面普通浏览器返回 false。
 */
function isAppleTouchDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIPhoneOrIPad = /iPhone|iPad/i.test(ua);
  // iPadOS 13+ 默认上报 Macintosh,用 maxTouchPoints 区分真桌面 Mac
  const isModernIPad = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  return isIPhoneOrIPad || isModernIPad;
}

/**
 * 检测当前是否使用手机版(双屏/多屏)界面。
 * iPhone / iPad / 小屏(<= maxWidth)= true,Mac 桌面普通浏览器 = false。
 *
 * 用 matchMedia 监听屏幕大小变化(用户旋转设备 / 调整窗口大小时自动切换)。
 */
export function useMobile(maxWidth = 760): boolean {
  const computeIsMobile = () => {
    if (typeof window === "undefined") return false;
    if (isAppleTouchDevice()) return true;
    return window.matchMedia(`(max-width: ${maxWidth}px)`).matches;
  };

  const [isMobile, setIsMobile] = useState(computeIsMobile);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const handler = () => setIsMobile(computeIsMobile());
    // iPad 旋转时设备判定不变(始终 true),宽度判定也走同一回调,统一刷新
    handler();
    if (mql.addEventListener) {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    // 兼容老 Safari
    mql.addListener(handler);
    return () => mql.removeListener(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxWidth]);

  return isMobile;
}
