import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { MonthTable, getCellTotal } from "./components/MonthTable";
import { ScanModal } from "./components/ScanModal";
import { SettingsModal } from "./components/SettingsModal";
import { ShopPaymentModal } from "./components/ShopPaymentModal";
import { YearlyStatsModal } from "./components/YearlyStatsModal";
import { ExportModal } from "./components/ExportModal";
import { MobileMonthList } from "./components/MobileMonthList";
import { MobileDayDetail } from "./components/MobileDayDetail";
import { MobileStoreMonthDetail } from "./components/MobileStoreMonthDetail";
import { useMobile } from "./lib/useMobile";
import { extractAmount } from "./lib/chineseNumber";
import { createEmptyMonth, initialMonths, shops } from "./data/seedData";
import { isAdminMode } from "./lib/adminMode";
import { exportExcel, getBackupStatus, recordNewEntryForBackupReminder } from "./lib/exporter";
import {
  clearOcrSettings,
  fileToDataUrl,
  loadOcrSettings,
  saveOcrSettings,
  recognizeDeliveryNote,
  type OcrResult,
  type OcrSettings,
} from "./lib/ocr";
import {
  addCloudAlias,
  addCloudKnownShop,
  fetchCloudAliases,
  fetchCloudKnownShops,
  fetchDeliveries,
  flushPendingSync,
  upsertDelivery,
  deleteDelivery,
  fetchPaymentState,
  upsertPaymentState,
} from "./lib/cloudStore";
import {
  getDeliveryForPart,
  loadStoredMonths,
  mergeCloudDeliveries,
  saveStoredMonths,
} from "./lib/dashboardStore";
import type { AmountCell, AmountPart, MonthData } from "./types/dashboard";

const MAX_BATCH = 10;

const findMonth = (months: MonthData[], year: number, month: number) => {
  return months.find((item) => item.year === year && item.month === month);
};

const getMonthTotal = (month: MonthData) => {
  const total = Object.values(month.cells).reduce((sum, dayCells) => {
    return sum + Object.values(dayCells).reduce((daySum, cell) => daySum + getCellTotal(cell), 0);
  }, 0);
  return Math.round(total * 100) / 100;
};

type ActiveView = "month" | "shopPayment";

export default function App() {
  const [months, setMonths] = useState<MonthData[]>(() => loadStoredMonths());
  const [selectedYear, setSelectedYear] = useState(2026);
  const [selectedMonth, setSelectedMonth] = useState(5);
  const [searchText, setSearchText] = useState("");
  const [notice, setNotice] = useState("");
  const [activeView, setActiveView] = useState<ActiveView>("month");

  const [showScanModal, setShowScanModal] = useState(false);
  const [showYearlyStats, setShowYearlyStats] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ day: number; shop: string } | null>(null);
  // 移动端:当前在月份列表还是当日明细;选中的日期
  const isMobile = useMobile(760);
  const [mobileView, setMobileView] = useState<"monthList" | "dayDetail" | "shopPayment" | "storeMonth">("monthList");
  const [mobileSelectedDay, setMobileSelectedDay] = useState<number>(new Date().getDate());
  const [mobileSelectedStore, setMobileSelectedStore] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [adminMode] = useState(() => isAdminMode());
  const [backupStatus, setBackupStatus] = useState(() => getBackupStatus());
  const [backupBannerDismissed, setBackupBannerDismissed] = useState(false);
  const [shopPaymentEdits, setShopPaymentEdits] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem("delivery-shop-payment-edits-v1");
      const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  // 店铺本月明细"核算确认"状态。key = `${year}:${month}:${shop}`,值为 "1" 表示已核对。本地存储,不上云。
  const [storeReconcile, setStoreReconcile] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem("delivery-store-reconcile-v1");
      const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  // payment_state 每个云端键(pe:/rc:)的本地最后修改时间戳(ISO),用于 last-write-wins 同步
  const [paymentTs, setPaymentTs] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem("delivery-payment-ts-v1");
      const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  // 每周本机 Excel 备份提醒:记录上次在本机保存的日期(ISO),启动时若超 7 天则弹提示
  const [localBackupDue, setLocalBackupDue] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchIndex, setBatchIndex] = useState(-1);
  // 预识别结果缓存。每张图独立一项：preview 是 dataURL，status 反映识别进度。
  type BatchItem = {
    preview: string;
    status: "pending" | "done" | "error";
    result?: OcrResult;
    error?: string;
  };
  const [batchResults, setBatchResults] = useState<BatchItem[]>([]);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [ocrSettings, setOcrSettings] = useState<OcrSettings | null>(() => loadOcrSettings());
  const [scanInitial, setScanInitial] = useState<Partial<OcrResult> | undefined>(undefined);
  const [scanError, setScanError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pendingCount = useMemo(() => {
    return months.reduce((sum, m) => {
      return sum + Object.values(m.cells).reduce((daySum, dayCells) => {
        return daySum + Object.values(dayCells).reduce((cellSum, cell) => {
          return cellSum + (cell?.parts.filter((p) => p.status === "待补充").length ?? 0);
        }, 0);
      }, 0);
    }, 0);
  }, [months]);

  const currentMonth = useMemo(() => {
    return findMonth(months, selectedYear, selectedMonth);
  }, [months, selectedMonth, selectedYear]);

  useEffect(() => {
    saveStoredMonths(months);
    setBackupStatus(getBackupStatus());
  }, [months]);

  const handleRestoreFromJson = (restoredMonths: MonthData[]) => {
    setMonths((current) => {
      // 把恢复的 months 当作"云端"数据走 merge 逻辑,以较新者为准
      const restoredDeliveries = restoredMonths.flatMap((m) =>
        Object.entries(m.cells).flatMap(([day, dayCells]) =>
          Object.entries(dayCells ?? {}).flatMap(([shop, cell]) => {
            if (!cell) return [];
            return cell.parts.map((part) => getDeliveryForPart(m.year, m.month, Number(day), shop, part, cell.updatedAt));
          })
        )
      );
      const merged = mergeCloudDeliveries(current, restoredDeliveries);
      saveStoredMonths(merged);
      // 顺便把这些条目异步上传到云,确保多端一致
      for (const delivery of restoredDeliveries) {
        upsertDelivery(delivery);
      }
      return merged;
    });
    setNotice("已从备份恢复并合并");
  };

  useEffect(() => {
    let cancelled = false;

    const syncFromCloud = async () => {
      const syncedCount = await flushPendingSync();
      const cloudDeliveries = await fetchDeliveries();
      if (cancelled) return;
      if (cloudDeliveries.length > 0) {
        setMonths((current) => {
          const merged = mergeCloudDeliveries(current, cloudDeliveries);
          saveStoredMonths(merged);
          return merged;
        });
        setNotice((current) => current || "已同步云端数据");
      } else if (syncedCount > 0) {
        setNotice((current) => current || `已补传 ${syncedCount} 条离线数据`);
      }
    };

    syncFromCloud();

    const handleOnline = () => {
      syncFromCloud();
    };
    window.addEventListener("online", handleOnline);

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncCloudDictionary = async () => {
      const [cloudAliases, cloudKnownShops] = await Promise.all([
        fetchCloudAliases(),
        fetchCloudKnownShops(),
      ]);
      if (cancelled) return;

      setOcrSettings((current) => {
        if (!current) return current;
        const merged: OcrSettings = {
          ...current,
          knownShops: Array.from(new Set([...cloudKnownShops, ...(current.knownShops ?? [])])),
          shopAliases: {
            ...cloudAliases,
            ...(current.shopAliases ?? {}),
          },
        };
        saveOcrSettings(merged);
        return merged;
      });
    };

    syncCloudDictionary();

    return () => {
      cancelled = true;
    };
  }, []);

  // 手动云同步:把待同步队列发出去 + 拉云端最新合并到本地
  const handleManualSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setNotice("正在同步云端…");
    try {
      const pushed = await flushPendingSync();
      const cloudDeliveries = await fetchDeliveries();
      setMonths((current) => {
        const merged = mergeCloudDeliveries(current, cloudDeliveries);
        saveStoredMonths(merged);
        return merged;
      });
      // 同步收款确认/核算确认状态(跨设备)
      await syncPaymentState();
      const parts: string[] = [];
      if (pushed > 0) parts.push(`上传 ${pushed} 条`);
      parts.push(`拉取 ${cloudDeliveries.length} 条`);
      setNotice(`✓ 同步完成(${parts.join(",")})`);
    } catch (err) {
      setNotice(`同步失败:${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
      // 3 秒后清提示
      setTimeout(() => setNotice((cur) => (cur.startsWith("✓ 同步完成") || cur.startsWith("同步失败") ? "" : cur)), 3000);
    }
  };

  // 启动时检查:距上次"本机 Excel 备份"是否已超 7 天,是则弹提示
  useEffect(() => {
    try {
      const last = localStorage.getItem("delivery-local-excel-backup-v1");
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (!last || Date.now() - new Date(last).getTime() >= sevenDays) {
        setLocalBackupDue(true);
      }
    } catch {
      // localStorage 不可用时不弹,不阻塞主流程
    }
  }, []);

  // 启动时拉取云端收款确认/核算确认状态并合并(跨 iPhone/iPad 同步)
  useEffect(() => {
    void syncPaymentState();
    // 仅启动跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自动拉取:收款确认/核算确认 + 送货数据。静默(无提示),失败忽略。
  const autoPull = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    // 正在输入(焦点在输入框)时本轮跳过,避免轮询打断打字/重置输入框
    const ae = typeof document !== "undefined" ? document.activeElement : null;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
    void syncPaymentState();
    fetchDeliveries()
      .then((cloud) =>
        setMonths((current) => {
          const merged = mergeCloudDeliveries(current, cloud);
          saveStoredMonths(merged);
          return merged;
        })
      )
      .catch(() => {
        /* 网络失败忽略,下次再试 */
      });
  };

  // ① 切回前台 / 获得焦点时立即拉(iOS PWA 不会重新 mount)
  // ② 前台时每 8 秒轮询一次 —— 这样"两台都开着摆在一起"也能自动同步(无需切屏/点同步)
  useEffect(() => {
    document.addEventListener("visibilitychange", autoPull);
    window.addEventListener("focus", autoPull);
    const interval = setInterval(autoPull, 8000);
    return () => {
      document.removeEventListener("visibilitychange", autoPull);
      window.removeEventListener("focus", autoPull);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 点"立即保存":在用户手势内导出 Excel(iOS 才允许下载),并记下今天
  const handleSaveLocalBackup = () => {
    try {
      exportExcel(months);
      localStorage.setItem("delivery-local-excel-backup-v1", new Date().toISOString());
      setNotice("✓ 已保存 Excel 备份到本机");
      setTimeout(() => setNotice((cur) => (cur.startsWith("✓ 已保存 Excel") ? "" : cur)), 3000);
    } catch (err) {
      setNotice(`导出失败:${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLocalBackupDue(false);
    }
  };

  // 点"稍后":本次启动不再提示(不写日期,下次启动若仍超 7 天会再提示)
  const handleSnoozeLocalBackup = () => setLocalBackupDue(false);

  const handleSelectYear = (year: number) => {
    const yearMonths = months.filter((item) => item.year === year).sort((a, b) => b.month - a.month);

    setSelectedYear(year);
    setSelectedMonth(yearMonths[0]?.month ?? 1);
    setActiveView("month");
    setNotice(yearMonths.length ? "" : "当前年份还没有月份，点击 + 新增 1 月");
  };

  const handleSelectMonth = (year: number, month: number) => {
    setSelectedYear(year);
    setSelectedMonth(month);
    setActiveView("month");
    setNotice("");
  };

  const handleAddMonth = () => {
    const yearMonths = months.filter((item) => item.year === selectedYear);
    const maxMonth = yearMonths.reduce((max, item) => Math.max(max, item.month), 0);

    if (maxMonth >= 12) {
      setNotice("当前年份已满 12 个月");
      return;
    }

    const nextMonth = maxMonth === 0 ? 1 : maxMonth + 1;
    const newMonth = createEmptyMonth(selectedYear, nextMonth);

    setMonths((current) => [newMonth, ...current]);
    setSelectedMonth(nextMonth);
    setActiveView("month");
    setNotice(`${selectedYear}年${nextMonth}月已新增`);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, MAX_BATCH);
    if (!files.length) return;
    setBatchFiles(files);
    setBatchIndex(-1);
    setShowScanModal(false);
    setFileName(files.length === 1 ? files[0].name : `${files.length} 张图片`);
    setNotice(
      (event.target.files?.length ?? 0) > MAX_BATCH
        ? `一次最多 ${MAX_BATCH} 张，已取前 ${MAX_BATCH} 张`
        : ""
    );
  };

  // 从缓存显示第 index 张：直接读 batchResults，无 API 调用，瞬时切换
  const showBatchAt = (items: BatchItem[], index: number) => {
    const item = items[index];
    if (!item) return;
    setBatchIndex(index);
    setImagePreview(item.preview);
    if (item.status === "done" && item.result) {
      setScanError("");
      setScanInitial(item.result);
    } else if (item.status === "error") {
      setScanError(item.error || "识别失败");
      setScanInitial({ shop: "", month: selectedMonth, day: 0, amount: 0, remark: "" });
    } else {
      // 仍在识别中——清空表单，提示"识别中"
      setScanError("");
      setScanInitial(undefined);
    }
    setShowScanModal(true);
  };

  // 并发预识别。CONCURRENCY=3 防限流，结果按 index 写回 batchResults。
  const prerecognizeBatch = async (files: File[], previews: string[]) => {
    if (!ocrSettings) return;
    // 把历史出现过的所有店面（跨所有月份）合并进 knownShops，让模型把潦草字匹配过去
    const historicalShops = Array.from(
      new Set(months.flatMap((m) => m.stores))
    );
    const mergedKnownShops = Array.from(
      new Set([...(ocrSettings.knownShops ?? []), ...historicalShops])
    );
    const effectiveSettings = { ...ocrSettings, knownShops: mergedKnownShops };
    const CONCURRENCY = 3;
    let cursor = 0;
    let doneCount = 0;
    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= files.length) return;
        try {
          const result = await recognizeDeliveryNote(previews[i], effectiveSettings);
          setBatchResults((cur) => {
            const next = cur.slice();
            next[i] = { ...next[i], status: "done", result };
            return next;
          });
          // 如果用户当前正盯着这张且还在 pending 视图，自动把识别结果填进表单
          setBatchIndex((curIdx) => {
            if (curIdx === i) {
              setScanInitial(result);
              setScanError("");
            }
            return curIdx;
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setBatchResults((cur) => {
            const next = cur.slice();
            next[i] = { ...next[i], status: "error", error: message };
            return next;
          });
          setBatchIndex((curIdx) => {
            if (curIdx === i) {
              setScanError(message);
                setScanInitial({ shop: "", month: selectedMonth, day: 0, amount: 0, remark: "" });
            }
            return curIdx;
          });
        } finally {
          doneCount++;
          setNotice(`预识别进度 ${doneCount}/${files.length}`);
        }
      }
    };
    setScanning(true);
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
    setScanning(false);
    setNotice(`已全部识别完成（${files.length} 张），请逐张确认入账`);
  };

  const finishBatch = () => {
    setShowScanModal(false);
    setBatchFiles([]);
    setBatchResults([]);
    setBatchIndex(-1);
    setFileName(null);
    setImagePreview(null);
    setScanInitial(undefined);
    setScanError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleStartScan = async () => {
    if (!batchFiles.length) {
      setNotice("请先选择送货单图片");
      return;
    }
    if (!ocrSettings) {
      setNotice("请先在左上角齿轮里配置识别服务的 API Key");
      setShowSettings(true);
      return;
    }
    // 1. 一次性把所有图片读成 dataURL，初始化缓存为 pending
    setNotice("正在读取图片…");
    const previews = await Promise.all(batchFiles.map(fileToDataUrl));
    const initial: BatchItem[] = previews.map((p) => ({ preview: p, status: "pending" }));
    setBatchResults(initial);
    // 2. 立刻显示第 1 张（此时还在识别，弹窗里会显示"识别中"）
    showBatchAt(initial, 0);
    // 3. 后台并发预识别，结果回填到对应 index；用户已经在看第 1 张了
    prerecognizeBatch(batchFiles, previews);
  };

  const handleSkipImage = () => {
    const next = batchIndex + 1;
    if (next < batchFiles.length) {
      showBatchAt(batchResults, next);
    } else {
      finishBatch();
      setNotice("批量处理完成");
    }
  };

  const handleSaveSettings = (settings: OcrSettings) => {
    saveOcrSettings(settings);
    setOcrSettings(settings);
    setShowSettings(false);
    setNotice("识别服务已保存");
    for (const shop of settings.knownShops ?? []) {
      addCloudKnownShop(shop);
    }
    for (const [alias, canonical] of Object.entries(settings.shopAliases ?? {})) {
      addCloudAlias(alias, canonical);
    }
  };

  const handleClearSettings = () => {
    clearOcrSettings();
    setOcrSettings(null);
    setShowSettings(false);
    setNotice("识别服务设置已清除");
  };

  // ===== payment_state 跨设备同步(last-write-wins by updated_at) =====
  // 用 ref 镜像最新 state,供事件监听/异步同步读取,避免闭包过期
  const peRef = useRef(shopPaymentEdits);
  peRef.current = shopPaymentEdits;
  const rcRef = useRef(storeReconcile);
  rcRef.current = storeReconcile;
  const tsRef = useRef(paymentTs);
  tsRef.current = paymentTs;

  // 待上云写入(去抖):cloudKey -> {value, ts, timer}
  const pendingCloudUpserts = useRef(new Map<string, { value: string; ts: string; timer: ReturnType<typeof setTimeout> }>());

  // 同一个 cloudKey 的上云请求**串行化**:前一个写完才发下一个,保证最终值一定最后落库,
  // 杜绝"网络乱序导致中间值(如打 62 时的 6)覆盖最终值"的截断 bug。
  const upsertChains = useRef(new Map<string, Promise<unknown>>());
  const serializedUpsert = (cloudKey: string, value: string, ts: string): Promise<boolean> => {
    const prev = upsertChains.current.get(cloudKey) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(() => upsertPaymentState(cloudKey, value, ts));
    upsertChains.current.set(
      cloudKey,
      next.catch(() => {})
    );
    return next;
  };

  const scheduleCloudUpsert = (cloudKey: string, value: string, ts: string, delayMs: number) => {
    const map = pendingCloudUpserts.current;
    const existing = map.get(cloudKey);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      map.delete(cloudKey);
      void serializedUpsert(cloudKey, value, ts);
    }, delayMs);
    map.set(cloudKey, { value, ts, timer });
  };

  const flushCloudUpserts = async () => {
    const map = pendingCloudUpserts.current;
    const pushes: Promise<boolean>[] = [];
    for (const [cloudKey, { value, ts, timer }] of map.entries()) {
      clearTimeout(timer);
      pushes.push(serializedUpsert(cloudKey, value, ts));
    }
    map.clear();
    if (pushes.length) await Promise.allSettled(pushes);
  };

  // 记录某 cloudKey 的本地时间戳并持久化
  const bumpPaymentTs = (cloudKey: string, ts: string) => {
    setPaymentTs((cur) => {
      const next = { ...cur, [cloudKey]: ts };
      try {
        localStorage.setItem("delivery-payment-ts-v1", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const handleShopPaymentEdit = (key: string, value: string) => {
    const ts = new Date().toISOString();
    setShopPaymentEdits((current) => {
      const next = { ...current, [key]: value };
      try {
        localStorage.setItem("delivery-shop-payment-edits-v1", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    bumpPaymentTs(`pe:${key}`, ts);
    // 去抖上云:打字停顿 400ms 后只传最后一次(带时间戳)。失败也没关系,下次同步靠时间戳重传
    scheduleCloudUpsert(`pe:${key}`, value, ts, 400);
  };

  const handleShowShopPayment = () => {
    setActiveView("shopPayment");
    setNotice("");
  };

  // 切换某店铺当月的"核算确认"状态:本地 + 上云("1"=已确认 / "0"=取消)
  const handleToggleReconcile = (year: number, month: number, shop: string) => {
    const key = `${year}:${month}:${shop}`;
    const ts = new Date().toISOString();
    const nextVal = storeReconcile[key] === "1" ? "0" : "1";
    const next = { ...storeReconcile, [key]: nextVal };
    setStoreReconcile(next);
    try {
      localStorage.setItem("delivery-store-reconcile-v1", JSON.stringify(next));
    } catch {
      /* ignore */
    }
    bumpPaymentTs(`rc:${key}`, ts);
    scheduleCloudUpsert(`rc:${key}`, nextVal, ts, 0);
  };

  // 同步 payment_state:先 flush 待上云 → 拉云端 → 按 updated_at last-write-wins 逐键合并
  // 本地更新(或云端没有)→ 推上去(自动重传失败的);云端更新 → 拉下来。彻底防回退、防丢失。
  const syncingPaymentRef = useRef(false);
  const syncPaymentStateRef = useRef<() => Promise<void>>(async () => {});
  syncPaymentStateRef.current = async () => {
    // 互斥:同一时刻只允许一个同步在跑,避免并发互相覆盖(打开页面时启动/focus/轮询会同时触发)
    if (syncingPaymentRef.current) return;
    syncingPaymentRef.current = true;
    try {
    await flushCloudUpserts();
    const rows = await fetchPaymentState();
    // ⚠️ 拉取失败(返回 null)→ 直接退出,绝不用空数据覆盖本地。
    // 这正是"显示一下又变回原样"的根因:并发的某次拉取失败,拿空云端覆盖了刚拉对的值。
    if (rows === null) return;
    const cloud = new Map<string, { value: string; ts: string }>();
    for (const r of rows) cloud.set(r.key, { value: r.value, ts: r.updated_at });

    const localPe = peRef.current;
    const localRc = rcRef.current;
    const localTs = tsRef.current;
    const localMap = new Map<string, string>();
    for (const [k, v] of Object.entries(localPe)) localMap.set(`pe:${k}`, v);
    for (const [k, v] of Object.entries(localRc)) localMap.set(`rc:${k}`, v);

    const allKeys = new Set<string>([...localMap.keys(), ...cloud.keys()]);
    const mergedPe: Record<string, string> = {};
    const mergedRc: Record<string, string> = {};
    const mergedTs: Record<string, string> = {};
    const pushes: Promise<boolean>[] = [];

    for (const ck of allKeys) {
      const c = cloud.get(ck);
      const hasLocal = localMap.has(ck);
      const localV = localMap.get(ck);
      const localT = localTs[ck];
      const localMs = localT ? new Date(localT).getTime() : 0;
      const cloudMs = c ? new Date(c.ts).getTime() : -1;

      let winnerV: string;
      let winnerT: string;
      if (c && cloudMs >= localMs) {
        // 云端更新(或一样新)→ 云端赢
        winnerV = c.value;
        winnerT = c.ts;
      } else {
        // 本地更新或云端没有 → 本地赢,推上去(自动重传)
        winnerV = localV ?? "";
        winnerT = localT ?? new Date().toISOString();
        if (hasLocal) pushes.push(serializedUpsert(ck, winnerV, winnerT));
      }
      mergedTs[ck] = winnerT;
      if (ck.startsWith("pe:")) mergedPe[ck.slice(3)] = winnerV;
      else if (ck.startsWith("rc:")) mergedRc[ck.slice(3)] = winnerV;
    }
    if (pushes.length) await Promise.allSettled(pushes);

    setShopPaymentEdits(mergedPe);
    setStoreReconcile(mergedRc);
    setPaymentTs(mergedTs);
    try {
      localStorage.setItem("delivery-shop-payment-edits-v1", JSON.stringify(mergedPe));
      localStorage.setItem("delivery-store-reconcile-v1", JSON.stringify(mergedRc));
      localStorage.setItem("delivery-payment-ts-v1", JSON.stringify(mergedTs));
    } catch {
      /* ignore */
    }
    } finally {
      syncingPaymentRef.current = false;
    }
  };
  const syncPaymentState = () => syncPaymentStateRef.current();

  const handleMonthCellChange = (day: number, shop: string, value: string) => {
    const trimmedValue = value.trim();
    // 兼容三种输入:
    //   - 阿拉伯数字 "238" / "66.5"
    //   - iOS 听写出来的中文数字 "二百三十八" / "六十六点五"
    //   - 带单位的口语 "238块" / "六十六块五" / "三十五块六毛"
    let amount = 0;
    if (trimmedValue !== "") {
      const parsed = extractAmount(trimmedValue);
      if (parsed === null || !Number.isFinite(parsed) || parsed < 0) {
        setNotice("请输入正确金额(支持数字或中文,如 238 / 二百三十八 / 六十六块五)");
        return false;
      }
      amount = parsed;
    }

    const targetMonth = findMonth(months, selectedYear, selectedMonth);
    const existingCell = targetMonth?.cells[day]?.[shop];
    const existingTotal = getCellTotal(existingCell);

    if (existingTotal === amount) {
      return true;
    }

    if (amount > 0 && existingTotal > 0) {
      const confirmed = window.confirm(
        `${selectedYear}年${selectedMonth}月${day}日 ${shop} 已有 ${existingTotal} 元，确认改为 ${amount} 元吗？`
      );
      if (!confirmed) {
        return false;
      }
    }

    const updatedAt = new Date().toISOString();
    const oldPartIds = existingCell?.parts.map((part) => part.id) ?? [];
    const newPart: AmountPart | null =
      amount > 0
        ? {
            id: `manual-${selectedYear}-${selectedMonth}-${day}-${shop}`,
            amount,
            remark: "手工录入",
            status: "已确认",
            createdAt: existingCell?.parts[0]?.createdAt ?? updatedAt,
          }
        : null;

    // 清空(金额改为 0)直接执行,不再弹确认 — 用户明确要求

    setMonths((current) =>
      current.map((month) => {
        if (month.year !== selectedYear || month.month !== selectedMonth) {
          return month;
        }

        const dayCells = { ...(month.cells[day] ?? {}) };

        if (amount <= 0) {
          delete dayCells[shop];
        } else {
          dayCells[shop] = {
            parts: [newPart!],
            updatedAt,
          };
        }

        return {
          ...month,
          cells: {
            ...month.cells,
            [day]: dayCells,
          },
          updatedAt,
        };
      })
    );

    setNotice(
      amount > 0
        ? `已修改：${selectedMonth}月${day}日 ${shop} ${amount}`
        : `已清空：${selectedMonth}月${day}日 ${shop}`
    );

    if (newPart) {
      upsertDelivery(getDeliveryForPart(selectedYear, selectedMonth, day, shop, newPart, updatedAt));
      recordNewEntryForBackupReminder();
      for (const id of oldPartIds.filter((id) => id !== newPart.id)) {
        deleteDelivery(id);
      }
    } else {
      for (const id of oldPartIds) {
        deleteDelivery(id);
      }
    }

    return true;
  };

  const handleScanConfirm = (data: { shop: string; month: number; day: number; amount: number; remark: string }) => {
    const targetMonth = findMonth(months, selectedYear, selectedMonth);
    if (!targetMonth) {
      setNotice("当前月份不存在");
      return;
    }

    // 自动学习字迹纠正：如果用户把模型识别的 shop 改成了别的，记入 shopAliases
    const ocrShop = batchResults[batchIndex]?.result?.shop?.trim();
    if (ocrShop && ocrShop !== data.shop && ocrSettings) {
      const newAliases = { ...(ocrSettings.shopAliases ?? {}), [ocrShop]: data.shop };
      const updatedSettings: OcrSettings = { ...ocrSettings, shopAliases: newAliases };
      saveOcrSettings(updatedSettings);
      setOcrSettings(updatedSettings);
      addCloudAlias(ocrShop, data.shop);
    }


    const maxDay = new Date(selectedYear, selectedMonth, 0).getDate();
    if (data.month !== selectedMonth) {
      setNotice("本次只支持录入当前月份，如需其他月份请先切换月份");
      return;
    }
    if (data.day < 1 || data.day > maxDay) {
      setNotice("本次只支持录入当前月份，如需其他月份请先切换月份");
      return;
    }

    if (data.amount <= 0) {
      setNotice("金额必须大于 0");
      return;
    }

    // 疑似重复检测
    const existingParts: AmountPart[] = targetMonth.cells[data.day]?.[data.shop]?.parts ?? [];
    const duplicate = existingParts.find((p) => p.amount === data.amount);
    if (duplicate) {
      const confirmed = window.confirm(
        `疑似重复：${selectedYear}年${selectedMonth}月${data.day}日 ${data.shop} 已有 ${data.amount} 元记录，确认继续入账？`
      );
      if (!confirmed) {
        return;
      }
    }

    // 新店面检测
    const isNewShop = !targetMonth.stores.includes(data.shop);
    if (isNewShop) {
      const confirmed = window.confirm(
        `店面【${data.shop}】不是当前月份已有店面，确认新增并入账吗？`
      );
      if (!confirmed) {
        return;
      }
    }

    // 执行入账
    const newPart: AmountPart = {
      id: `part-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      amount: data.amount,
      remark: data.remark || undefined,
      status: "已确认",
      createdAt: new Date().toISOString(),
    };
    const updatedAt = new Date().toISOString();

    setMonths((current) =>
      current.map((m) => {
        if (m.year !== selectedYear || m.month !== selectedMonth) {
          return m;
        }

        const existingCell = m.cells[data.day]?.[data.shop];
        const updatedCell: AmountCell = {
          parts: [...(existingCell?.parts ?? []), newPart],
          updatedAt,
        };

        const updatedCells = {
          ...m.cells,
          [data.day]: {
            ...(m.cells[data.day] ?? {}),
            [data.shop]: updatedCell,
          },
        };

        const updatedStores = isNewShop ? [...m.stores, data.shop] : m.stores;

        return {
          ...m,
          cells: updatedCells,
          stores: updatedStores,
          updatedAt,
        };
      })
    );

    upsertDelivery(getDeliveryForPart(selectedYear, selectedMonth, data.day, data.shop, newPart, updatedAt));
    recordNewEntryForBackupReminder();
    if (isNewShop) {
      addCloudKnownShop(data.shop);
    }

    const parts = [...existingParts, newPart];
    const sumLine = parts.map((p) => p.amount).join(" + ");
    const recordMsg = `已入账：${selectedMonth}月${data.day}日 ${data.shop} ${sumLine} = ${parts.reduce((s, p) => s + p.amount, 0)}`;

    // 自动跳下一张（读缓存，瞬时切换）
    const next = batchIndex + 1;
    if (next < batchFiles.length) {
      setNotice(`${recordMsg}（继续第 ${next + 1}/${batchFiles.length} 张）`);
      showBatchAt(batchResults, next);
    } else {
      finishBatch();
      setNotice(`${recordMsg}（全部 ${batchFiles.length} 张已处理完）`);
    }
  };

  // ============ 移动端分支:iPhone 双屏 UI ============
  if (isMobile) {
    // 移动端"店铺收款确认"页(用 ShopPaymentModal 撑满整屏)
    if (mobileView === "shopPayment") {
      return (
        <main className="mobile-app mobile-shoppayment-page">
          <header className="mobile-detail-header">
            <div className="mobile-header-left">
              <button className="mobile-icon" onClick={() => setMobileView("monthList")} aria-label="返回">
                <span style={{ fontSize: 20 }}>‹</span>
              </button>
              <button
                className={`mobile-sync-btn ${syncing ? "icon-spinning" : ""}`}
                onClick={handleManualSync}
                disabled={syncing}
                aria-label="同步保存"
              >
                <RefreshCw size={15} />
                {syncing ? "同步中" : "同步"}
              </button>
            </div>
            <div className="center">
              <div className="title">店铺收款确认</div>
              <div className="sub">{selectedYear} 年</div>
            </div>
            <div style={{ width: 38 }} />
          </header>
          <div className="mobile-shoppayment-shell">
            <ShopPaymentModal
              year={selectedYear}
              months={months}
              shops={shops}
              edits={shopPaymentEdits}
              onEdit={handleShopPaymentEdit}
            />
          </div>
        </main>
      );
    }

    if (mobileView === "monthList" || !currentMonth) {
      return (
        <main className="mobile-app">
          <MobileMonthList
            months={months}
            selectedYear={selectedYear}
            selectedMonth={selectedMonth}
            pendingCount={pendingCount}
            getMonthTotal={getMonthTotal}
            onSelectMonth={(year, month) => {
              handleSelectMonth(year, month);
              setMobileView("dayDetail");
            }}
            onShopPayment={() => {
              setMobileView("shopPayment");
            }}
            onAddMonth={handleAddMonth}
            onOpenSettings={() => setShowSettings(true)}
            onExport={() => setShowExport(true)}
            onSync={handleManualSync}
            syncing={syncing}
          />
          {notice && <div className="mobile-toast">{notice}</div>}
          {localBackupDue && (
            <div className="modal-backdrop" role="presentation" onClick={handleSnoozeLocalBackup}>
              <section
                className="detail-modal local-backup-modal"
                role="dialog"
                aria-modal="true"
                aria-label="每周本机备份提醒"
                onClick={(event) => event.stopPropagation()}
              >
                <header>
                  <h3>每周本机备份</h3>
                </header>
                <p className="local-backup-text">
                  距上次在本机保存 Excel 已超过 7 天。建议现在存一份到本设备(iPad / 手机),云端之外多一重保险。
                </p>
                <div className="local-backup-actions">
                  <button type="button" className="snooze" onClick={handleSnoozeLocalBackup}>
                    稍后
                  </button>
                  <button type="button" className="save" onClick={handleSaveLocalBackup}>
                    立即保存
                  </button>
                </div>
              </section>
            </div>
          )}
          {showSettings && (
            <SettingsModal
              current={ocrSettings}
              onSave={handleSaveSettings}
              onClear={handleClearSettings}
              onClose={() => setShowSettings(false)}
            />
          )}
          {showExport && (
            <ExportModal
              months={months}
              isAdmin={adminMode}
              onClose={() => setShowExport(false)}
              onRestore={handleRestoreFromJson}
            />
          )}
        </main>
      );
    }
    // mobileView === "storeMonth" 店铺当月每天明细
    if (mobileView === "storeMonth" && mobileSelectedStore) {
      return (
        <main className="mobile-app">
          <MobileStoreMonthDetail
            monthData={currentMonth}
            shop={mobileSelectedStore}
            onBack={() => setMobileView("dayDetail")}
            onChangeCell={handleMonthCellChange}
            onSelectDay={(day) => {
              setMobileSelectedDay(day);
              setMobileView("dayDetail");
            }}
            confirmed={storeReconcile[`${selectedYear}:${selectedMonth}:${mobileSelectedStore}`] === "1"}
            onToggleConfirm={() => handleToggleReconcile(selectedYear, selectedMonth, mobileSelectedStore)}
            onSync={handleManualSync}
            syncing={syncing}
          />
        </main>
      );
    }

    // mobileView === "dayDetail"
    return (
      <main className="mobile-app">
        <MobileDayDetail
          monthData={currentMonth}
          selectedDay={mobileSelectedDay}
          onChangeDay={setMobileSelectedDay}
          onChangeCell={handleMonthCellChange}
          onBack={() => setMobileView("monthList")}
          onSelectStoreMonth={(shop) => {
            setMobileSelectedStore(shop);
            setMobileView("storeMonth");
          }}
          onSync={handleManualSync}
          syncing={syncing}
        />
        {/* 隐藏的文件 input,通过 fileInputRef 触发拍照/选图 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        {showScanModal && (
          <ScanModal
            key={batchIndex}
            currentYear={selectedYear}
            currentMonth={selectedMonth}
            maxDay={new Date(selectedYear, selectedMonth, 0).getDate()}
            existingShops={currentMonth.stores}
            initialData={scanInitial}
            imagePreview={imagePreview ?? undefined}
            recognizeError={scanError || undefined}
            recognizing={batchResults[batchIndex]?.status === "pending"}
            batchPosition={batchFiles.length > 1 ? { index: batchIndex, total: batchFiles.length } : undefined}
            onConfirm={handleScanConfirm}
            onSkip={batchIndex + 1 < batchFiles.length || batchFiles.length > 1 ? handleSkipImage : undefined}
            onClose={finishBatch}
          />
        )}
      </main>
    );
  }

  // ============ 桌面 / iPad 分支(原版) ============
  if (!currentMonth) {
    return (
      <main className="dashboard">
        <Sidebar
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          isShopPaymentActive={activeView === "shopPayment"}
          months={months}
          searchText={searchText}
          onSelectYear={handleSelectYear}
          onSelectMonth={handleSelectMonth}
          onSearchTextChange={setSearchText}
          onAddMonth={handleAddMonth}
          onYearlyStats={() => setShowYearlyStats(true)}
          onShopPayment={handleShowShopPayment}
          onExport={() => setShowExport(true)}
          fileInputRef={fileInputRef}
          fileName={fileName}
          onFileChange={handleFileChange}
          onStartScan={handleStartScan}
          onOpenSettings={() => setShowSettings(true)}
          onSync={handleManualSync}
          syncing={syncing}
          scanning={scanning}
          pendingCount={pendingCount}
          getMonthTotal={getMonthTotal}
        />

        <section className="content" aria-label="当前月份金额统计">
          <header className="content-header">
            <div>
              <h2>{activeView === "shopPayment" ? "店铺收款确认" : `${selectedYear}年`}</h2>
              {notice && <p className="notice-text">{notice}</p>}
            </div>
          </header>
          {activeView === "shopPayment" ? (
            <ShopPaymentModal
              year={selectedYear}
              months={months}
              shops={shops}
              edits={shopPaymentEdits}
              onEdit={handleShopPaymentEdit}
            />
          ) : (
            <div className="empty-state">当前年份还没有月份，点击左侧 + 新增月份。</div>
          )}
        </section>

        {showSettings && (
          <SettingsModal
            current={ocrSettings}
            onSave={handleSaveSettings}
            onClear={handleClearSettings}
            onClose={() => setShowSettings(false)}
          />
        )}

        {showExport && (
          <ExportModal
            months={months}
            isAdmin={adminMode}
            onClose={() => setShowExport(false)}
            onRestore={handleRestoreFromJson}
          />
        )}
      </main>
    );
  }

  return (
    <main className="dashboard">
      <Sidebar
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        isShopPaymentActive={activeView === "shopPayment"}
        months={months}
        searchText={searchText}
        onSelectYear={handleSelectYear}
        onSelectMonth={handleSelectMonth}
        onSearchTextChange={setSearchText}
        onAddMonth={handleAddMonth}
        onYearlyStats={() => setShowYearlyStats(true)}
        onShopPayment={handleShowShopPayment}
        onExport={() => setShowExport(true)}
        fileInputRef={fileInputRef}
        fileName={fileName}
        onFileChange={handleFileChange}
        onStartScan={handleStartScan}
        onOpenSettings={() => setShowSettings(true)}
        onSync={handleManualSync}
        syncing={syncing}
        scanning={scanning}
        pendingCount={pendingCount}
        getMonthTotal={getMonthTotal}
      />

      <section className="content" aria-label="当前月份金额统计">
        <header className="content-header">
          <h2>{activeView === "shopPayment" ? "店铺收款确认" : `${selectedYear}年${selectedMonth}月`}</h2>
          {notice && <span className="notice-text inline-notice">{notice}</span>}
        </header>

        {backupStatus.shouldRemind && !backupBannerDismissed && (
          <div className="backup-banner" role="status">
            <span>
              {backupStatus.reason === "never" && `💾 已累积 ${backupStatus.newRecordsSinceBackup} 条新记录,建议导出备份`}
              {backupStatus.reason === "stale" && `⏰ 上次备份 ${backupStatus.daysSinceBackup} 天前,建议再导一次`}
              {backupStatus.reason === "many_new" && `💾 累计 ${backupStatus.newRecordsSinceBackup} 条新记录未备份,点这里导出`}
            </span>
            <div>
              <button type="button" className="backup-banner-action" onClick={() => setShowExport(true)}>
                立即备份
              </button>
              <button type="button" className="backup-banner-dismiss" onClick={() => setBackupBannerDismissed(true)} aria-label="关闭提示">
                ✕
              </button>
            </div>
          </div>
        )}

        {activeView === "shopPayment" ? (
          <ShopPaymentModal
            year={selectedYear}
            months={months}
            shops={shops}
            edits={shopPaymentEdits}
            onEdit={handleShopPaymentEdit}
          />
        ) : (
          <MonthTable
            monthData={currentMonth}
            onChangeCell={handleMonthCellChange}
            onCellFocus={(day, shop) => setSelectedCell({ day, shop })}
            selectedCell={selectedCell}
          />
        )}
      </section>

      {showScanModal && currentMonth && (
        <ScanModal
          key={batchIndex}
          currentYear={selectedYear}
          currentMonth={selectedMonth}
          maxDay={new Date(selectedYear, selectedMonth, 0).getDate()}
          existingShops={currentMonth.stores}
          initialData={scanInitial}
          imagePreview={imagePreview ?? undefined}
          recognizeError={scanError || undefined}
          recognizing={batchResults[batchIndex]?.status === "pending"}
          batchPosition={batchFiles.length > 1 ? { index: batchIndex, total: batchFiles.length } : undefined}
          onConfirm={handleScanConfirm}
          onSkip={batchIndex + 1 < batchFiles.length || batchFiles.length > 1 ? handleSkipImage : undefined}
          onClose={finishBatch}
        />
      )}

      {showSettings && (
        <SettingsModal
          current={ocrSettings}
          onSave={handleSaveSettings}
          onClear={handleClearSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showYearlyStats && (
        <YearlyStatsModal
          year={selectedYear}
          months={months}
          onSelectMonth={handleSelectMonth}
          onClose={() => setShowYearlyStats(false)}
        />
      )}

      {showExport && (
        <ExportModal
          months={months}
          isAdmin={adminMode}
          onClose={() => setShowExport(false)}
          onRestore={handleRestoreFromJson}
        />
      )}
    </main>
  );
}
