/**
 * 项目内置的识别记忆库（v1，2026-05-31）
 *
 * - knownShops: 已知客户白名单，注入 prompt 让模型优先匹配。
 * - shopAliases: 字迹纠正字典，识别后自动替换。
 *
 * ⚠️ 规则（落实给 AI Agent 和后续维护者）：
 *   1. 这是"硬持久化"层，App 启动时和 localStorage 合并加载。
 *   2. App 运行时学到的新映射存在 localStorage（"软层"）。
 *   3. 当 localStorage 积累足够新数据时，应导出回这个文件（"软 → 硬"提升），
 *      否则换浏览器/清缓存会丢失。
 *   4. 修改字典前必须人工审核：避免错误映射污染。
 *   5. 任何对 knownShops 或 shopAliases 的更新都要同步到此文件，
 *      并 commit 到 git，作为"项目记忆"长期保存。
 *
 * 数据来源：基于 25 张真实手写送货单的人工标注（user + AI 联合）。
 */

/** 已知客户白名单 */
export const BUILT_IN_KNOWN_SHOPS: string[] = [
  "萍姐",
  "万杨",
  "万醉",
  "柳",
  "吾醉",
  "保虾4",
  "五洲",
];

/** 字迹纠正字典：模型识别值 → 真实店名 */
export const BUILT_IN_SHOP_ALIASES: Record<string, string> = {
  万木易: "万杨",
  万西市: "万醉",
  "萍姐（晓）": "萍姐",
  吉西产: "吾醉",
  "仔玖（4）": "保虾4",
  木瓜: "柳",
  万顺平: "万醉",
  杨甲: "柳",
  吾湘: "五洲",
  保虾: "保虾4",
};

/** 合并内置 + 用户增量数据，去重；用户增量优先 */
export function mergeKnownShops(userShops?: string[]): string[] {
  const merged = [...BUILT_IN_KNOWN_SHOPS, ...(userShops ?? [])];
  return Array.from(new Set(merged.filter(Boolean)));
}

/** 合并内置 + 用户增量字典；用户增量优先（用户改过的覆盖内置） */
export function mergeShopAliases(userAliases?: Record<string, string>): Record<string, string> {
  return { ...BUILT_IN_SHOP_ALIASES, ...(userAliases ?? {}) };
}
