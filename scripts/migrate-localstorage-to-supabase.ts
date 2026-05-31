/**
 * 一次性迁移脚本：把浏览器 localStorage 里的本地账单数据导入 Supabase。
 *
 * 使用前先在旧网页打开浏览器 Console，运行下面代码导出 JSON：
 *
 * const data = {
 *   exportedAt: new Date().toISOString(),
 *   months: JSON.parse(localStorage.getItem("delivery-dashboard-months-v1") || "[]")
 * };
 * const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
 * const a = document.createElement("a");
 * a.href = URL.createObjectURL(blob);
 * a.download = "delivery-localstorage-export.json";
 * a.click();
 * URL.revokeObjectURL(a.href);
 *
 * 然后在终端运行：
 *
 * VITE_SUPABASE_URL="https://your-project.supabase.co" \
 * VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_xxx" \
 * npx tsx scripts/migrate-localstorage-to-supabase.ts delivery-localstorage-export.json
 *
 * 注意：脚本只新增/更新 deliveries，不会删除云端数据。
 */
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

interface AmountPart {
  id: string;
  amount: number;
  remark?: string;
  createdAt: string;
}

interface AmountCell {
  parts: AmountPart[];
  updatedAt: string;
}

interface MonthData {
  year: number;
  month: number;
  cells: Record<string, Record<string, AmountCell | undefined>>;
}

const filePath = process.argv[2];
const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

if (!filePath) {
  console.error("请传入导出的 JSON 文件路径");
  process.exit(1);
}

if (!url || !key) {
  console.error("请先设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const raw = await readFile(filePath, "utf8");
const parsed = JSON.parse(raw) as { months?: MonthData[] } | MonthData[];
const months = Array.isArray(parsed) ? parsed : parsed.months ?? [];

const rows = months.flatMap((month) => {
  return Object.entries(month.cells ?? {}).flatMap(([dayText, dayCells]) => {
    const day = Number(dayText);
    const deliveryDate = `${month.year}-${String(month.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    return Object.entries(dayCells ?? {}).flatMap(([shopName, cell]) => {
      return (cell?.parts ?? []).map((part) => ({
        id: stableDeliveryId(part.id),
        delivery_date: deliveryDate,
        shop_name: shopName,
        order_no: part.id,
        amount: part.amount,
        raw_ocr_text: part.remark ?? null,
        device: "migration",
        created_at: part.createdAt,
        updated_at: cell.updatedAt,
      }));
    });
  });
});

if (!rows.length) {
  console.log("没有找到可迁移的账单数据。");
  process.exit(0);
}

const supabase = createClient(url, key);
const batchSize = 100;
let inserted = 0;

for (let i = 0; i < rows.length; i += batchSize) {
  const batch = rows.slice(i, i + batchSize);
  const { error } = await supabase.from("deliveries").upsert(batch, { onConflict: "id" });
  if (error) {
    console.error("迁移失败：", error.message);
    process.exit(1);
  }
  inserted += batch.length;
  console.log(`已迁移 ${inserted}/${rows.length}`);
}

console.log(`完成：共迁移 ${inserted} 条。`);

function stableDeliveryId(input: string): string {
  const bytes = hash128(input);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hash128(input: string): Uint8Array {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  let h3 = 0x9e3779b9;
  let h4 = 0x85ebca6b;

  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ ch, 2246822507);
    h4 = Math.imul(h4 ^ ch, 3266489909);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(0, h1 >>> 0);
  new DataView(bytes.buffer).setUint32(4, h2 >>> 0);
  new DataView(bytes.buffer).setUint32(8, h3 >>> 0);
  new DataView(bytes.buffer).setUint32(12, h4 >>> 0);
  return bytes;
}
