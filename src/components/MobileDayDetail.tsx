import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Mic, Plus, CalendarDays, RefreshCw } from "lucide-react";
import type { MonthData, ShopName } from "../types/dashboard";
import { extractAmount } from "../lib/chineseNumber";

interface MobileDayDetailProps {
  monthData: MonthData;
  selectedDay: number;
  onChangeDay: (day: number) => void;
  onChangeCell: (day: number, shop: ShopName, value: string) => boolean;
  onBack: () => void;
  /** 点顶部某店铺名 → 跳转到该店本月明细 */
  onSelectStoreMonth: (shop: string) => void;
  /** 手动同步云端 */
  onSync: () => void;
  syncing: boolean;
}

const MAX_LABELED_STORES = 12;
const TOTAL_STORE_SLOTS = 13;
const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

// Web Speech API 类型
type SpeechRecognitionEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type SpeechRecognition = EventTarget & {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};
function getSpeechCtor(): (new () => SpeechRecognition) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const getCellAmount = (monthData: MonthData, day: number, shop: string): number => {
  const cell = monthData.cells[day]?.[shop];
  if (!cell) return 0;
  return Math.round(cell.parts.reduce((s, p) => s + p.amount, 0) * 100) / 100;
};

export function MobileDayDetail({
  monthData,
  selectedDay,
  onChangeDay,
  onChangeCell,
  onBack,
  onSelectStoreMonth,
  onSync,
  syncing,
}: MobileDayDetailProps) {
  const totalDays = daysInMonth(monthData.year, monthData.month);
  // 限制到 12 家显示 + 补足 1 空白 = 13 行
  const displayedStores = monthData.stores.slice(0, MAX_LABELED_STORES);
  const blankSlots = Math.max(TOTAL_STORE_SLOTS - displayedStores.length, 0);

  // 当日合计
  const dayTotal = useMemo(() => {
    return displayedStores.reduce((s, shop) => s + getCellAmount(monthData, selectedDay, shop), 0);
  }, [monthData, selectedDay, displayedStores]);

  const goPrevDay = () => onChangeDay(Math.max(1, selectedDay - 1));
  const goNextDay = () => onChangeDay(Math.min(totalDays, selectedDay + 1));

  // 日期选择器:label 包 input,iOS 点 label 自动触发原生 picker
  const datePickerRef = useRef<HTMLInputElement>(null);
  const onDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; // "YYYY-MM-DD"
    if (!val) return;
    const parts = val.split("-").map(Number);
    if (parts.length === 3 && parts[0] === monthData.year && parts[1] === monthData.month) {
      const d = parts[2];
      if (d >= 1 && d <= totalDays) onChangeDay(d);
    }
  };
  const dateValue = `${monthData.year}-${String(monthData.month).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`;
  const minDate = `${monthData.year}-${String(monthData.month).padStart(2, "0")}-01`;
  const maxDate = `${monthData.year}-${String(monthData.month).padStart(2, "0")}-${String(totalDays).padStart(2, "0")}`;

  // 语音输入相关状态
  const [listeningShop, setListeningShop] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const startVoice = (shop: string) => {
    const Ctor = getSpeechCtor();
    if (!Ctor) {
      alert("浏览器不支持语音(请用 Safari/Chrome)");
      return;
    }
    try {
      recognitionRef.current?.abort();
    } catch {
      // ignore
    }
    const rec = new Ctor();
    rec.lang = "zh-CN";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => setListeningShop(shop);
    rec.onend = () => setListeningShop(null);
    rec.onerror = (e) => {
      setListeningShop(null);
      if (e.error === "not-allowed") {
        alert("麦克风权限被拒。设置 → Safari → 麦克风 → 允许");
      }
    };
    rec.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const num = extractAmount(transcript);
      if (num !== null && num > 0) {
        onChangeCell(selectedDay, shop, String(num));
      } else {
        alert(`听到"${transcript}",未识别到金额`);
      }
    };
    try {
      rec.start();
      recognitionRef.current = rec;
    } catch {
      setListeningShop(null);
    }
  };

  const stopVoice = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
  };

  // 顶部最多 12 家店铺
  const topStores = displayedStores.slice(0, MAX_LABELED_STORES);
  const topBlankCount = Math.max(12 - topStores.length, 0);

  return (
    <div className="mobile-page mobile-daydetail">
      {/* 顶部:返回 + 12 店铺按钮(2排×6,点击跳店铺月度明细) */}
      <header className="mobile-shop-grid-header">
        <div className="mobile-header-left">
          <button className="mobile-icon" onClick={onBack} aria-label="返回">
            <ChevronLeft size={20} />
          </button>
          <button
            className={`mobile-sync-btn ${syncing ? "icon-spinning" : ""}`}
            onClick={onSync}
            disabled={syncing}
            aria-label="同步保存"
          >
            <RefreshCw size={15} />
            {syncing ? "同步中" : "同步"}
          </button>
        </div>
        <div className="mobile-shop-grid">
          {topStores.map((shop) => (
            <button
              key={shop}
              type="button"
              className="mobile-shop-chip"
              onClick={() => onSelectStoreMonth(shop)}
              aria-label={`查看 ${shop} 本月明细`}
            >
              {shop}
            </button>
          ))}
          {Array.from({ length: topBlankCount }).map((_, idx) => (
            <button
              key={`top-blank-${idx}`}
              type="button"
              className="mobile-shop-chip blank"
              disabled
            >
              空白
            </button>
          ))}
        </div>
      </header>

      <div className="mobile-date-card">
        <button className="arrow" onClick={goPrevDay} aria-label="前一天" disabled={selectedDay <= 1}>
          <ChevronLeft size={20} />
        </button>
        <div className="center">
          <div className="day-block">
            <div className="label">{monthData.year}年{monthData.month}月</div>
            <div className="day">{selectedDay} 日</div>
            <div className="total">合计 ¥{Math.round(dayTotal * 100) / 100}</div>
          </div>
          {/* 用 <label> 包 <input type="date"> — iOS 原生触发日期选择器,不依赖 showPicker() */}
          <label
            className="cal-btn"
            aria-label="选择日期"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <CalendarDays size={22} />
            <input
              ref={datePickerRef}
              type="date"
              value={dateValue}
              min={minDate}
              max={maxDate}
              onChange={onDateInputChange}
              className="cal-btn-input"
              aria-hidden="true"
            />
          </label>
        </div>
        <button className="arrow" onClick={goNextDay} aria-label="后一天" disabled={selectedDay >= totalDays}>
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="mobile-shop-list">
        {displayedStores.map((shop) => {
          const amount = getCellAmount(monthData, selectedDay, shop);
          const isListening = listeningShop === shop;
          return (
            <div
              key={shop}
              className={`mobile-shop-row ${amount > 0 ? "has-value" : "zero"}`}
            >
              <span className="name">{shop}</span>
              <input
                className={`amount ${amount > 0 ? "" : "zero"}`}
                type="text"
                inputMode="decimal"
                defaultValue={amount || ""}
                placeholder="0"
                key={`${selectedDay}-${shop}-${amount}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                onBlur={(e) => {
                  const ok = onChangeCell(selectedDay, shop, e.currentTarget.value);
                  if (!ok) e.currentTarget.value = amount ? String(amount) : "";
                }}
              />
              <button
                type="button"
                className={`mic ${isListening ? "listening" : ""}`}
                onClick={() => (isListening ? stopVoice() : startVoice(shop))}
                aria-label={`语音输入 ${shop}`}
              >
                <Mic size={14} />
              </button>
            </div>
          );
        })}
        {Array.from({ length: blankSlots }).map((_, idx) => (
          <div className="mobile-shop-row blank" key={`blank-${idx}`}>
            <span className="name">空白</span>
            <input className="amount" type="text" disabled placeholder="" />
            <button type="button" className="mic" disabled aria-label="新增客户(暂未实现)">
              <Plus size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
