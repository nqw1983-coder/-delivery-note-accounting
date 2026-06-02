import * as XLSX from "xlsx";
import { monthsToDeliveries, type DeliveryRecord } from "./dashboardStore";
import type { MonthData } from "../types/dashboard";

export type ExportFormat = "xlsx" | "csv" | "json";

export interface ExportFilters {
  /** 起始日期 YYYY-MM-DD(含),不填则不限 */
  startDate?: string;
  /** 结束日期 YYYY-MM-DD(含),不填则不限 */
  endDate?: string;
  /** 限定店家,不填则全部 */
  shopName?: string;
}

export interface ExportBundle {
  version: 1;
  exportedAt: string;
  device: string;
  recordCount: number;
  deliveries: DeliveryRecord[];
  /** 完整月份快照(含手动新增的客户和零金额单元格) */
  months: MonthData[];
}

const LAST_BACKUP_KEY = "delivery-last-backup-at";
const NEW_RECORDS_SINCE_BACKUP_KEY = "delivery-new-records-since-backup";

// 表格显示常数,跟 App MonthTable 保持一致
const MAX_LABELED_STORES = 11;

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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 月份是否在筛选范围内(只看年月,粗筛) */
function monthInRange(year: number, month: number, filters?: ExportFilters): boolean {
  if (!filters) return true;
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  if (filters.startDate && ym < filters.startDate.slice(0, 7)) return false;
  if (filters.endDate && ym > filters.endDate.slice(0, 7)) return false;
  return true;
}

/** 月内某日某店金额(parts 求和) */
function cellAmount(month: MonthData, day: number, shop: string): number {
  const cell = month.cells[day]?.[shop];
  if (!cell) return 0;
  return Math.round(cell.parts.reduce((s, p) => s + p.amount, 0) * 100) / 100;
}

const daysInMonth = (year: number, month: number) =>
  new Date(year, month, 0).getDate();

/** 导出 Excel:每个月一个二维表(日期 × 客户),跟 App 表格视觉一致 */
export function exportExcel(months: MonthData[], filters?: ExportFilters): void {
  // 月份倒序(最新月在最前)
  const sortedMonths = months
    .filter((m) => monthInRange(m.year, m.month, filters))
    .filter((m) => m.stores.length > 0)
    .sort((a, b) => (b.year - a.year) * 100 + (b.month - a.month));

  const workbook = XLSX.utils.book_new();
  const filterByShop = filters?.shopName;

  for (const month of sortedMonths) {
    const sheetName = `${month.year}-${String(month.month).padStart(2, "0")}`;
    const baseStores = month.stores.slice(0, MAX_LABELED_STORES);
    const stores = filterByShop ? baseStores.filter((s) => s === filterByShop) : baseStores;
    if (stores.length === 0) continue;

    const days = Array.from({ length: daysInMonth(month.year, month.month) }, (_, i) => i + 1);

    // 表头:日期 | 店1 | 店2 | ... | 当日合计
    const data: (string | number)[][] = [["日期", ...stores, "当日合计"]];

    // 每天一行
    for (const day of days) {
      const row: (string | number)[] = [`${day}日`];
      let dayTotal = 0;
      for (const shop of stores) {
        const amt = cellAmount(month, day, shop);
        row.push(amt);
        dayTotal += amt;
      }
      row.push(Math.round(dayTotal * 100) / 100);
      data.push(row);
    }

    // 本月合计行
    const totalRow: (string | number)[] = ["本月合计"];
    let grandTotal = 0;
    for (const shop of stores) {
      const shopTotal = days.reduce((s, day) => s + cellAmount(month, day, shop), 0);
      totalRow.push(Math.round(shopTotal * 100) / 100);
      grandTotal += shopTotal;
    }
    totalRow.push(Math.round(grandTotal * 100) / 100);
    data.push(totalRow);

    const sheet = XLSX.utils.aoa_to_sheet(data);
    sheet["!cols"] = [
      { wch: 8 },
      ...stores.map(() => ({ wch: 10 })),
      { wch: 12 },
    ];
    sheet["!rows"] = [{ hpx: 22 }];
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  }

  if (workbook.SheetNames.length === 0) {
    const emptySheet = XLSX.utils.aoa_to_sheet([
      ["该筛选条件下没有数据"],
      [filters?.startDate ? `起始日期: ${filters.startDate}` : ""],
      [filters?.endDate ? `结束日期: ${filters.endDate}` : ""],
      [filters?.shopName ? `客户: ${filters.shopName}` : ""],
    ]);
    XLSX.utils.book_append_sheet(workbook, emptySheet, "无数据");
  }

  const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, buildFileName("送货单", "xlsx", filters));
  markBackup(monthsToDeliveries(months).length);
}

/** 导出 CSV:跟 Excel 一致的二维表,但合并所有月份到一个文件,月之间空一行隔开 */
export function exportCsv(months: MonthData[], filters?: ExportFilters): void {
  const sortedMonths = months
    .filter((m) => monthInRange(m.year, m.month, filters))
    .filter((m) => m.stores.length > 0)
    .sort((a, b) => (b.year - a.year) * 100 + (b.month - a.month));

  const filterByShop = filters?.shopName;
  const escape = (v: string | number): string => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines: string[] = [];
  for (const month of sortedMonths) {
    const baseStores = month.stores.slice(0, MAX_LABELED_STORES);
    const stores = filterByShop ? baseStores.filter((s) => s === filterByShop) : baseStores;
    if (stores.length === 0) continue;

    const days = Array.from({ length: daysInMonth(month.year, month.month) }, (_, i) => i + 1);

    lines.push(`${month.year}年${month.month}月`);
    lines.push(["日期", ...stores, "当日合计"].map(escape).join(","));

    let monthGrand = 0;
    const shopTotals: Record<string, number> = {};
    for (const shop of stores) shopTotals[shop] = 0;

    for (const day of days) {
      let dayTotal = 0;
      const cells: (string | number)[] = [`${day}日`];
      for (const shop of stores) {
        const amt = cellAmount(month, day, shop);
        cells.push(amt);
        dayTotal += amt;
        shopTotals[shop] += amt;
      }
      cells.push(Math.round(dayTotal * 100) / 100);
      monthGrand += dayTotal;
      lines.push(cells.map(escape).join(","));
    }

    const totalRow: (string | number)[] = ["本月合计"];
    for (const shop of stores) totalRow.push(Math.round(shopTotals[shop] * 100) / 100);
    totalRow.push(Math.round(monthGrand * 100) / 100);
    lines.push(totalRow.map(escape).join(","));
    lines.push(""); // 月之间空行隔开
  }

  if (lines.length === 0) {
    lines.push("该筛选条件下没有数据");
  }

  const csv = "﻿" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, buildFileName("送货单", "csv", filters));
  markBackup(monthsToDeliveries(months).length);
}

/** 导出完整 JSON 快照:用于灾难恢复(保留完整结构,含 parts/createdAt 等元信息) */
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
      shouldRemind: newRecords >= 20,
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
