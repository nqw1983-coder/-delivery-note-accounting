import { createEmptyMonth, initialMonths, shops } from "../data/seedData";
import type { AmountCell, AmountPart, MonthData } from "../types/dashboard";

export interface DeliveryRecord {
  id: string;
  delivery_date: string;
  shop_name: string;
  order_no: string | null;
  amount: number | null;
  raw_ocr_text: string | null;
  device: string | null;
  created_at: string;
  updated_at: string;
}

const MONTHS_STORAGE_KEY = "delivery-dashboard-months-v1";

const toDateString = (year: number, month: number, day: number) => {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
};

const parseDateString = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
};

export function loadStoredMonths(): MonthData[] {
  try {
    const raw = localStorage.getItem(MONTHS_STORAGE_KEY);
    if (!raw) return normalizeMonthStores(initialMonths);
    const parsed = JSON.parse(raw) as MonthData[];
    return Array.isArray(parsed) && parsed.length ? normalizeMonthStores(parsed) : normalizeMonthStores(initialMonths);
  } catch {
    return normalizeMonthStores(initialMonths);
  }
}

function normalizeMonthStores(months: MonthData[]): MonthData[] {
  return months.map((month) => ({
    ...month,
    stores: [...shops, ...month.stores.filter((shop) => !shops.includes(shop))],
  }));
}

export function saveStoredMonths(months: MonthData[]): void {
  localStorage.setItem(MONTHS_STORAGE_KEY, JSON.stringify(months));
}

export function monthsToDeliveries(months: MonthData[]): DeliveryRecord[] {
  const records: DeliveryRecord[] = [];

  for (const month of months) {
    for (const [dayKey, dayCells] of Object.entries(month.cells)) {
      const day = Number(dayKey);
      if (!Number.isFinite(day)) continue;

      for (const [shop, cell] of Object.entries(dayCells)) {
        if (!cell) continue;
        for (const part of cell.parts) {
          records.push({
            id: stableDeliveryId(part.id),
            delivery_date: toDateString(month.year, month.month, day),
            shop_name: shop,
            order_no: part.id,
            amount: part.amount,
            raw_ocr_text: part.remark ?? null,
            device: getDeviceName(),
            created_at: part.createdAt,
            updated_at: cell.updatedAt,
          });
        }
      }
    }
  }

  return records;
}

export function mergeCloudDeliveries(months: MonthData[], deliveries: DeliveryRecord[]): MonthData[] {
  const baseByMonth = new Map<string, MonthData>();

  for (const month of months) {
    baseByMonth.set(`${month.year}-${month.month}`, {
      ...month,
      stores: [...month.stores],
      cells: Object.fromEntries(
        Object.entries(month.cells).map(([day, dayCells]) => [
          day,
          Object.fromEntries(
            Object.entries(dayCells).map(([shop, cell]) => [
              shop,
              cell
                ? {
                    ...cell,
                    parts: [...cell.parts],
                  }
                : cell,
            ])
          ),
        ])
      ),
    });
  }

  for (const delivery of deliveries) {
    if (!delivery.id || !delivery.delivery_date || !delivery.shop_name || !delivery.amount) continue;
    const { year, month, day } = parseDateString(delivery.delivery_date);
    if (!year || !month || !day) continue;

    const monthKey = `${year}-${month}`;
    const target = baseByMonth.get(monthKey) ?? createEmptyMonth(year, month);
    if (!target.stores.includes(delivery.shop_name)) {
      target.stores = [...target.stores, delivery.shop_name];
    }

    const existingCell = target.cells[day]?.[delivery.shop_name];
    const nextPart: AmountPart = {
      id: delivery.order_no || delivery.id,
      amount: Number(delivery.amount),
      remark: delivery.raw_ocr_text ?? undefined,
      status: "已确认",
      createdAt: delivery.created_at,
    };

    const currentParts = existingCell?.parts ?? [];
    const localPartId = delivery.order_no || delivery.id;
    const existingPart = currentParts.find((part) => part.id === localPartId);
    const cloudUpdatedAt = delivery.updated_at || delivery.created_at;
    const shouldReplace =
      !existingPart ||
      new Date(cloudUpdatedAt).getTime() >= new Date(existingCell?.updatedAt ?? existingPart.createdAt).getTime();

    if (!shouldReplace) {
      baseByMonth.set(monthKey, target);
      continue;
    }

    const nextParts = existingPart
      ? currentParts.map((part) => (part.id === localPartId ? nextPart : part))
      : [...currentParts, nextPart];
    const nextCell: AmountCell = {
      parts: nextParts,
      updatedAt: cloudUpdatedAt,
    };

    target.cells = {
      ...target.cells,
      [day]: {
        ...(target.cells[day] ?? {}),
        [delivery.shop_name]: nextCell,
      },
    };
    target.updatedAt = new Date(
      Math.max(new Date(target.updatedAt).getTime(), new Date(cloudUpdatedAt).getTime())
    ).toISOString();
    baseByMonth.set(monthKey, target);
  }

  return Array.from(baseByMonth.values()).sort((a, b) => b.year - a.year || b.month - a.month);
}

export function getDeliveryForPart(
  year: number,
  month: number,
  day: number,
  shop: string,
  part: AmountPart,
  updatedAt: string
): DeliveryRecord {
  return {
    id: stableDeliveryId(part.id),
    delivery_date: toDateString(year, month, day),
    shop_name: shop,
    order_no: part.id,
    amount: part.amount,
    raw_ocr_text: part.remark ?? null,
    device: getDeviceName(),
    created_at: part.createdAt,
    updated_at: updatedAt,
  };
}

function getDeviceName(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/iPad/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua))) return "iPad";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Macintosh/i.test(ua)) return "Mac";
  return "Browser";
}

export function stableDeliveryId(input: string): string {
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
