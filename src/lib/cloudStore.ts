import { supabase } from "./supabase";
import { stableDeliveryId, type DeliveryRecord } from "./dashboardStore";

type PendingOperation =
  | { type: "upsertDelivery"; payload: DeliveryRecord }
  | { type: "deleteDelivery"; payload: { id: string } }
  | { type: "addCloudAlias"; payload: { alias: string; canonical: string } }
  | { type: "addCloudKnownShop"; payload: { name: string } };

const PENDING_SYNC_KEY = "pending_sync";

function readQueue(): PendingOperation[] {
  try {
    const raw = localStorage.getItem(PENDING_SYNC_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: PendingOperation[]) {
  localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(queue));
}

function enqueue(operation: PendingOperation) {
  writeQueue([...readQueue(), operation]);
}

export async function fetchDeliveries(): Promise<DeliveryRecord[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("deliveries")
      .select("id,delivery_date,shop_name,order_no,amount,raw_ocr_text,device,created_at,updated_at")
      .order("delivery_date", { ascending: false });
    if (error) {
      console.warn("[cloud] fetchDeliveries failed", error.message);
      return [];
    }
    return (data ?? []).map((item) => ({
      ...item,
      amount: item.amount === null ? null : Number(item.amount),
    })) as DeliveryRecord[];
  } catch (error) {
    console.warn("[cloud] fetchDeliveries failed", error);
    return [];
  }
}

export async function upsertDelivery(delivery: DeliveryRecord): Promise<boolean> {
  if (!supabase) return true;
  try {
    const { error } = await supabase.from("deliveries").upsert(delivery, { onConflict: "id" });
    if (error) throw error;
    return true;
  } catch (error) {
    console.warn("[cloud] upsertDelivery queued", error);
    enqueue({ type: "upsertDelivery", payload: delivery });
    return false;
  }
}

export async function deleteDelivery(id: string): Promise<boolean> {
  if (!supabase) return true;
  try {
    const { error } = await supabase.from("deliveries").delete().eq("id", stableDeliveryId(id));
    if (error) throw error;
    return true;
  } catch (error) {
    console.warn("[cloud] deleteDelivery queued", error);
    enqueue({ type: "deleteDelivery", payload: { id } });
    return false;
  }
}

export async function fetchCloudAliases(): Promise<Record<string, string>> {
  if (!supabase) return {};
  try {
    const { data, error } = await supabase.from("shop_aliases").select("alias,canonical");
    if (error) {
      console.warn("[cloud] fetchCloudAliases failed", error.message);
      return {};
    }
    return Object.fromEntries((data ?? []).map((item) => [item.alias, item.canonical]));
  } catch (error) {
    console.warn("[cloud] fetchCloudAliases failed", error);
    return {};
  }
}

export async function addCloudAlias(alias: string, canonical: string): Promise<boolean> {
  const cleanAlias = alias.trim();
  const cleanCanonical = canonical.trim();
  if (!cleanAlias || !cleanCanonical) return true;
  if (!supabase) return true;
  try {
    const { error } = await supabase
      .from("shop_aliases")
      .upsert({ alias: cleanAlias, canonical: cleanCanonical }, { onConflict: "alias" });
    if (error) throw error;
    return true;
  } catch (error) {
    console.warn("[cloud] addCloudAlias queued", error);
    enqueue({ type: "addCloudAlias", payload: { alias: cleanAlias, canonical: cleanCanonical } });
    return false;
  }
}

export async function fetchCloudKnownShops(): Promise<string[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.from("known_shops").select("name");
    if (error) {
      console.warn("[cloud] fetchCloudKnownShops failed", error.message);
      return [];
    }
    return (data ?? []).map((item) => item.name).filter(Boolean);
  } catch (error) {
    console.warn("[cloud] fetchCloudKnownShops failed", error);
    return [];
  }
}

export async function addCloudKnownShop(name: string): Promise<boolean> {
  const cleanName = name.trim();
  if (!cleanName) return true;
  if (!supabase) return true;
  try {
    const { error } = await supabase.from("known_shops").upsert({ name: cleanName }, { onConflict: "name" });
    if (error) throw error;
    return true;
  } catch (error) {
    console.warn("[cloud] addCloudKnownShop queued", error);
    enqueue({ type: "addCloudKnownShop", payload: { name: cleanName } });
    return false;
  }
}

export async function flushPendingSync(): Promise<number> {
  if (!supabase) return 0;
  const queue = readQueue();
  if (!queue.length) return 0;

  const remaining: PendingOperation[] = [];
  let synced = 0;

  for (const operation of queue) {
    try {
      let error;
      if (operation.type === "upsertDelivery") {
        ({ error } = await supabase.from("deliveries").upsert(operation.payload, { onConflict: "id" }));
      } else if (operation.type === "deleteDelivery") {
        ({ error } = await supabase.from("deliveries").delete().eq("id", stableDeliveryId(operation.payload.id)));
      } else if (operation.type === "addCloudAlias") {
        ({ error } = await supabase
          .from("shop_aliases")
          .upsert(operation.payload, { onConflict: "alias" }));
      } else {
        ({ error } = await supabase
          .from("known_shops")
          .upsert(operation.payload, { onConflict: "name" }));
      }
      if (error) throw error;
      synced++;
    } catch (error) {
      console.warn("[cloud] pending operation still failed", error);
      remaining.push(operation);
    }
  }

  writeQueue(remaining);
  return synced;
}
