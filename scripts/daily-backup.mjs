#!/usr/bin/env node
/**
 * 每日备份脚本 — GitHub Actions 调用,本地也可手动跑。
 *
 * 用法:
 *   node scripts/daily-backup.mjs
 *
 * 输出:
 *   backups/YYYY-MM.csv    每月一份 CSV(覆盖式更新)
 *   backups/snapshot.json  完整 JSON 快照(用于灾难恢复)
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

async function main() {
  mkdirSync(BACKUP_DIR, { recursive: true });

  console.log("拉 Supabase deliveries...");
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/deliveries?select=*&order=delivery_date.asc`,
    {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
      },
    }
  );
  if (!res.ok) {
    throw new Error(`Supabase 拉数据失败: HTTP ${res.status}`);
  }
  const raw = await res.json();
  console.log(`拉取到 ${raw.length} 条记录`);

  // 按 YYYY-MM 分组
  const byMonth = new Map();
  for (const d of raw) {
    const ym = (d.delivery_date || "").slice(0, 7);
    if (!ym) continue;
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym).push(d);
  }

  // CSV 转义
  const escape = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = "日期,客户,金额,备注,录入设备,创建时间,更新时间";

  // 每月一份 CSV(覆盖写)
  for (const [ym, rows] of byMonth.entries()) {
    rows.sort((a, b) => a.delivery_date.localeCompare(b.delivery_date));
    const body = rows
      .map((d) =>
        [
          d.delivery_date,
          d.shop_name,
          d.amount ?? 0,
          d.raw_ocr_text ?? "",
          d.device ?? "",
          d.created_at,
          d.updated_at,
        ]
          .map(escape)
          .join(",")
      )
      .join("\n");
    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const footer = `本月合计,,${Math.round(total * 100) / 100},共 ${rows.length} 条,,,`;
    // 前置 UTF-8 BOM,Excel 打开不乱码
    const csv = "﻿" + header + "\n" + body + "\n" + footer + "\n";
    writeFileSync(join(BACKUP_DIR, `${ym}.csv`), csv);
    console.log(`  写入 backups/${ym}.csv (${rows.length} 条)`);
  }

  // 完整 JSON 快照
  const snapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: "github-actions-daily-backup",
    recordCount: raw.length,
    deliveries: raw,
  };
  writeFileSync(
    join(BACKUP_DIR, "snapshot.json"),
    JSON.stringify(snapshot, null, 2)
  );
  console.log(`  写入 backups/snapshot.json (${raw.length} 条)`);

  // README
  const readme = `# 自动备份

每天北京时间 18:05 由 \`.github/workflows/daily-backup.yml\` 自动更新。

## 文件

- \`YYYY-MM.csv\` — 按月份的 CSV(UTF-8 BOM,Excel 直接打开不乱码)
- \`snapshot.json\` — 完整 JSON 快照(可用于灾难恢复)

## 恢复任意一天的数据

\`\`\`bash
# 看 2026-06-01 当时的 5 月备份内容
git show \`git rev-list -n 1 --before=2026-06-01 master\`:backups/2026-05.csv

# 或者在 GitHub 网页:打开 backups 目录 → 点任意文件 → 右上 History 按钮 → 看每天差异
\`\`\`

## 手动运行备份(本地)

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
