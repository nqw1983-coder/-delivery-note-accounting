import * as XLSX from "xlsx";
import { monthsToDeliveries, type DeliveryRecord } from "./dashboardStore";
import type { MonthData } from "../types/dashboard";

export type ExportFormat = "xlsx" | "csv" | "json";

export interface ExportFilters {
  /** 起始日期 YYYY-MM-DD（含），不填则不限 */
  startDate?: string;
  /** 结束日期 YYYY-MM-DD（含），不填则不限 */
  endDate?: string;
  /** 限定店家，不填则全部 */
  shopName?: string;
}

export interface ExportBundle {
  version: 1;
  exportedAt: string;
  device: string;
  recordCount: number;
  deliveries: DeliveryRecord[];
  /** 完整月份快照（含手动新增的客户和零金额单元格） */
  months: MonthData[];
}

const LAST_BACKUP_KEY = "delivery-last-backup-at";
const NEW_RECORDS_SINCE_BACKUP_KEY = "delivery-new-records-since-backup";

function filterDeliveries(deliveries: DeliveryRecord[], filters?: ExportFilters): DeliveryRecord[] {
  if (!filters) return deliveries;
  return deliveries.filter((d) => {
    if (filters.startDate && d.delivery_date < filters.startDate) return false;
    if (filters.endDate && d.delivery_date > filters.endDate) return false;
    if (filters.shopName && d.shop_name !== filters.shopName) return false;
    return true;
  });
}

function buildFileName(prefix: string, format: ExportFormat, filters?: ExportFilters): string {
  const today = new Date().toISOString().slice(0, 10);
  const parts = [prefix, today];
  if (filters?.startDate || filters?.endDate) {
    parts.push(`${filters.startDate ?? "起"}_${filters.endDate ?? "今"}`);
  }
  if (filters?.shopName) {
    parts.push(filters.shopName);
  }
  return `${parts.join("_")}.${format}`;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // 给 Safari 一点时间触发下载,再释放 URL
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 导出 Excel:每个月一个工作表(Sheet),底部 tab 按月份切换,适合给老板按月看 */
export function exportExcel(months: MonthData[], filters?: ExportFilters): void {
  const all = monthsToDeliveries(months);
  const filtered = filterDeliveries(all, filters);

  // 按 YYYY-MM 分组
  const byMonth = new Map<string, typeof filtered>();
  for (const d of filtered) {
    const ym = d.delivery_date.slice(0, 7); // "2026-05"
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym)!.push(d);
  }

  // 按月份倒序(最新月在最前)
  const sortedMonths = Array.from(byMonth.keys()).sort().reverse();

  const workbook = XLSX.utils.book_new();
  const colWidths = [
    { wch: 12 }, // 日期
    { wch: 16 }, // 客户
    { wch: 10 }, // 金额
    { wch: 30 }, // 备注
    { wch: 10 }, // 设备
    { wch: 20 }, // 创建时间
  ];

  // 第 1 个 Sheet:全部数据汇总(便于跨月统计 / 筛选)
  const allRows = filtered.map((d) => ({
    日期: d.delivery_date,
    客户: d.shop_name,
    金额: d.amount ?? 0,
    备注: d.raw_ocr_text ?? "",
    录入设备: d.device ?? "",
    创建时间: d.created_at,
  }));
  const allSheet = XLSX.utils.json_to_sheet(allRows);
  allSheet["!cols"] = colWidths;
  XLSX.utils.book_append_sheet(workbook, allSheet, "全部");

  // 每个月一张 Sheet,按日期升序;Sheet 名 "2026-05" 格式
  for (const ym of sortedMonths) {
    const monthRows = byMonth.get(ym)!
      .sort((a, b) => a.delivery_date.localeCompare(b.delivery_date))
      .map((d) => ({
        日期: d.delivery_date,
        客户: d.shop_name,
        金额: d.amount ?? 0,
        备注: d.raw_ocr_text ?? "",
        录入设备: d.device ?? "",
        创建时间: d.created_at,
      }));
    // 加一行月小计在最末
    const monthTotal = monthRows.reduce((sum, r) => sum + (Number(r.金额) || 0), 0);
    monthRows.push({
      日期: "本月合计",
      客户: "",
      金额: Math.round(monthTotal * 100) / 100,
      备注: `共 ${monthRows.length} 条记录`,
      录入设备: "",
      创建时间: "",
    });

    const sheet = XLSX.utils.json_to_sheet(monthRows);
    sheet["!cols"] = colWidths;
    XLSX.utils.book_append_sheet(workbook, sheet, ym);
  }

  const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, buildFileName("送货单", "xlsx", filters));
  markBackup(filtered.length);
}

/** 导出 CSV:UTF-8 BOM 防 Excel 打开乱码 */
export function exportCsv(months: MonthData[], filters?: ExportFilters): void {
  const all = monthsToDeliveries(months);
  const rows = filterDeliveries(all, filters);
  const header = ["日期", "客户", "金额", "备注", "录入设备", "创建时间"];
  const escape = (val: string | number | null | undefined) => {
    const s = String(val ?? "");
    if (/[",\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const body = rows
    .map((d) =>
      [d.delivery_date, d.shop_name, d.amount ?? 0, d.raw_ocr_text ?? "", d.device ?? "", d.created_at]
        .map(escape)
        .join(",")
    )
    .join("\n");
  const csv = "﻿" + header.join(",") + "\n" + body;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, buildFileName("送货单", "csv", filters));
  markBackup(rows.length);
}

/** 导出完整 JSON 快照:可用于灾难恢复(还原全部数据 + 月份结构) */
export function exportJson(months: MonthData[]): void {
  const deliveries = monthsToDeliveries(months);
  const bundle: ExportBundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    device: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    recordCount: deliveries.length,
    deliveries,
    months,
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  triggerDownload(blob, buildFileName("送货单_完整备份", "json"));
  markBackup(deliveries.length);
}

/** 从 JSON 备份恢复数据(管理员功能)。返回还原的月份数组,调用方负责合并到现有状态。 */
export async function importJson(file: File): Promise<ExportBundle> {
  const text = await file.text();
  const parsed = JSON.parse(text) as ExportBundle;
  if (parsed.version !== 1 || !Array.isArray(parsed.months) || !Array.isArray(parsed.deliveries)) {
    throw new Error("备份文件格式不正确,无法识别");
  }
  return parsed;
}

// ========== 备份提醒状态 ==========

function markBackup(count: number) {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
    localStorage.setItem(NEW_RECORDS_SINCE_BACKUP_KEY, "0");
  } catch {
    // ignore
  }
  console.log(`[exporter] 已导出 ${count} 条`);
}

export function recordNewEntryForBackupReminder(): void {
  try {
    const cur = Number(localStorage.getItem(NEW_RECORDS_SINCE_BACKUP_KEY) ?? "0");
    localStorage.setItem(NEW_RECORDS_SINCE_BACKUP_KEY, String(cur + 1));
  } catch {
    // ignore
  }
}

export interface BackupStatus {
  lastBackupAt: string | null;
  daysSinceBackup: number | null;
  newRecordsSinceBackup: number;
  /** 是否应该提示用户备份 */
  shouldRemind: boolean;
  reason?: "never" | "stale" | "many_new";
}

export function getBackupStatus(): BackupStatus {
  let lastBackupAt: string | null = null;
  let newRecords = 0;
  try {
    lastBackupAt = localStorage.getItem(LAST_BACKUP_KEY);
    newRecords = Number(localStorage.getItem(NEW_RECORDS_SINCE_BACKUP_KEY) ?? "0");
  } catch {
    // ignore
  }

  if (!lastBackupAt) {
    return {
      lastBackupAt: null,
      daysSinceBackup: null,
      newRecordsSinceBackup: newRecords,
      shouldRemind: newRecords >= 20, // 第一次,攒了 20 条再提醒
      reason: newRecords >= 20 ? "never" : undefined,
    };
  }

  const daysSince = Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / (1000 * 60 * 60 * 24));
  if (newRecords >= 100) {
    return { lastBackupAt, daysSinceBackup: daysSince, newRecordsSinceBackup: newRecords, shouldRemind: true, reason: "many_new" };
  }
  if (daysSince >= 30 && newRecords > 0) {
    return { lastBackupAt, daysSinceBackup: daysSince, newRecordsSinceBackup: newRecords, shouldRemind: true, reason: "stale" };
  }
  return { lastBackupAt, daysSinceBackup: daysSince, newRecordsSinceBackup: newRecords, shouldRemind: false };
}
