import { useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { MonthTable, getCellTotal } from "./components/MonthTable";
import { ScanModal } from "./components/ScanModal";
import { SettingsModal } from "./components/SettingsModal";
import { ShopPaymentModal } from "./components/ShopPaymentModal";
import { YearlyStatsModal } from "./components/YearlyStatsModal";
import { ExportModal } from "./components/ExportModal";
import { createEmptyMonth, initialMonths, shops } from "./data/seedData";
import { isAdminMode } from "./lib/adminMode";
import { getBackupStatus, recordNewEntryForBackupReminder } from "./lib/exporter";
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
  const [adminMode] = useState(() => isAdminMode());
  const [backupStatus, setBackupStatus] = useState(() => getBackupStatus());
  const [backupBannerDismissed, setBackupBannerDismissed] = useState(false);
  const [shopPaymentEdits, setShopPaymentEdits] = useState<Record<string, string>>({});
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

  const handleShopPaymentEdit = (key: string, value: string) => {
    setShopPaymentEdits((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleShowShopPayment = () => {
    setActiveView("shopPayment");
    setNotice("");
  };

  const handleMonthCellChange = (day: number, shop: string, value: string) => {
    const trimmedValue = value.trim();
    const amount = trimmedValue === "" ? 0 : Number(trimmedValue);

    if (!Number.isFinite(amount) || amount < 0) {
      setNotice("请输入正确金额");
      return false;
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
        scanning={scanning}
        pendingCount={pendingCount}
        getMonthTotal={getMonthTotal}
      />

      <section className="content" aria-label="当前月份金额统计">
        <header className="content-header">
          <h2>{activeView === "shopPayment" ? "店铺收款确认" : `${selectedYear}年${selectedMonth}月`}</h2>
        </header>

        {notice && <p className="notice-text">{notice}</p>}

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
