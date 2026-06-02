#!/usr/bin/env node
/**
 * 每日备份脚本 — GitHub Actions 调用,本地也可手动跑。
 *
 * 输出二维表(日期 × 客户)而不是流水,跟 App 表格视觉一致。
 *
 * 用法:
 *   node scripts/daily-backup.mjs
 *
 * 输出:
 *   backups/YYYY-MM.csv    每月一份二维表 CSV(覆盖式更新)
 *   backups/snapshot.json  完整 JSON 快照(灾难恢复用,保留所有元信息)
 *   backups/README.md      使用说明
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const BACKUP_DIR = join(REPO_ROOT, "backups");

const SUPABASE_URL = "https://zaqeboyaltepwpavmvkf.supabase.co";
const KEY = "sb_publishable_sTUT0KON9Sgt2UZHWESKQQ_ed8dHX4_";

const MAX_LABELED_STORES = 11;

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

const escape = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  mkdirSync(BACKUP_DIR, { recursive: true });

  console.log("拉 Supabase deliveries...");
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/deliveries?select=*&order=delivery_date.asc`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
  );
  if (!res.ok) throw new Error(`Supabase 拉数据失败: HTTP ${res.status}`);
  const raw = await res.json();
  console.log(`拉取到 ${raw.length} 条记录`);

  // 按 YYYY-MM 分组,同时收集每月的店铺顺序(按首次出现顺序)
  const byMonth = new Map();
  for (const d of raw) {
    const date = d.delivery_date || "";
    const ym = date.slice(0, 7);
    if (!ym) continue;
    if (!byMonth.has(ym)) byMonth.set(ym, { rows: [], stores: [] });
    const m = byMonth.get(ym);
    m.rows.push(d);
    if (!m.stores.includes(d.shop_name)) m.stores.push(d.shop_name);
  }

  // 二维表 CSV(每月一个)
  for (const [ym, info] of byMonth.entries()) {
    const [yearStr, monthStr] = ym.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const stores = info.stores.slice(0, MAX_LABELED_STORES);
    const days = Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1);

    // amounts[day][shop] = sum
    const amounts = {};
    for (const d of info.rows) {
      const day = Number(d.delivery_date.slice(8, 10));
      if (!Number.isFinite(day)) continue;
      if (!amounts[day]) amounts[day] = {};
      const cur = amounts[day][d.shop_name] || 0;
      amounts[day][d.shop_name] = cur + Number(d.amount || 0);
    }

    const lines = [];
    lines.push(["日期", ...stores, "当日合计"].map(escape).join(","));

    const shopTotals = {};
    for (const s of stores) shopTotals[s] = 0;
    let monthGrand = 0;

    for (const day of days) {
      const row = [`${day}日`];
      let dayTotal = 0;
      for (const shop of stores) {
        const amt = Math.round((amounts[day]?.[shop] || 0) * 100) / 100;
        row.push(amt);
        dayTotal += amt;
        shopTotals[shop] += amt;
      }
      row.push(Math.round(dayTotal * 100) / 100);
      monthGrand += dayTotal;
      lines.push(row.map(escape).join(","));
    }

    const totalRow = ["本月合计"];
    for (const s of stores) totalRow.push(Math.round(shopTotals[s] * 100) / 100);
    totalRow.push(Math.round(monthGrand * 100) / 100);
    lines.push(totalRow.map(escape).join(","));

    const csv = "﻿" + lines.join("\n") + "\n";
    writeFileSync(join(BACKUP_DIR, `${ym}.csv`), csv);
    console.log(`  写入 backups/${ym}.csv (${days.length} 天 × ${stores.length} 家店)`);
  }

  // 完整 JSON 快照(用于灾难恢复)
  const snapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: "github-actions-daily-backup",
    recordCount: raw.length,
    deliveries: raw,
  };
  writeFileSync(join(BACKUP_DIR, "snapshot.json"), JSON.stringify(snapshot, null, 2));
  console.log(`  写入 backups/snapshot.json (${raw.length} 条)`);

  const readme = `# 自动备份

每天北京时间 18:05 由 \`.github/workflows/daily-backup.yml\` 自动更新。

## 文件

- \`YYYY-MM.csv\` — 二维表(日期 × 客户),跟 App 表格视觉一致,UTF-8 BOM,Excel 直接打开不乱码
- \`snapshot.json\` — 完整 JSON 快照,含所有元信息,用于灾难恢复

## 恢复任意一天的数据

\`\`\`bash
# 看 2026-06-01 当时的 5 月备份
git show \`git rev-list -n 1 --before=2026-06-01 master\`:backups/2026-05.csv

# 或在 GitHub 网页:打开 backups 目录 → 点任意 CSV → 右上 History → 看每天差异
\`\`\`

## 手动跑备份(本地)

\`\`\`bash
node scripts/daily-backup.mjs
\`\`\`
`;
  writeFileSync(join(BACKUP_DIR, "README.md"), readme);

  console.log("✅ 备份完成");
}

main().catch((err) => {
  console.error("备份失败:", err);
  process.exit(1);
});
