import { useEffect, useState } from "react";

/**
 * 检测当前是否为移动端尺寸(<= 760px 宽度)。
 * iPhone / 小屏 = true,iPad 横屏 / 桌面 = false。
 *
 * 用 matchMedia 监听屏幕大小变化(用户旋转设备 / 调整窗口大小时自动切换)。
 */
export function useMobile(maxWidth = 760): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${maxWidth}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    if (mql.addEventListener) {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    // 兼容老 Safari
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, [maxWidth]);

  return isMobile;
}
