import { useEffect, useRef, useState } from "react";
import { extractAmount } from "../lib/chineseNumber";

interface VoiceCellProps {
  day: number;
  shop: string;
  amount: number;
  onChange: (day: number, shop: string, value: string) => boolean;
}

// Web Speech API 类型(浏览器原生)
type SpeechRecognitionEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};
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

function getSpeechRecognitionCtor():
  | (new () => SpeechRecognition)
  | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function VoiceCell({ day, shop, amount, onChange }: VoiceCellProps) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState<string>("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 清理:组件卸载时停止识别
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const commitValue = (value: string) => {
    if (!inputRef.current) return;
    inputRef.current.value = value;
    const changed = onChange(day, shop, value);
    if (!changed) {
      inputRef.current.value = amount ? String(amount) : "";
    }
  };

  const startVoice = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      alert("此浏览器不支持语音识别。请用 Safari 或 Chrome,iPhone/iPad 完全支持");
      return;
    }
    const rec = new Ctor();
    rec.lang = "zh-CN";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setListening(true);
      setInterim("识别中...");
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.onerror = (event) => {
      console.warn("[voice] error:", event.error);
      setListening(false);
      setInterim("");
      if (event.error === "not-allowed") {
        alert("麦克风权限被拒。在 iPhone 设置 → Safari → 麦克风 → 允许");
      }
    };
    rec.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const num = extractAmount(transcript);
      if (num !== null && num > 0) {
        commitValue(String(num));
        setInterim(`✓ ${num}`);
        setTimeout(() => setInterim(""), 1500);
      } else {
        setInterim(`听到:"${transcript}",未识别到数字`);
        setTimeout(() => setInterim(""), 3000);
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
    } catch (err) {
      console.warn("[voice] start failed:", err);
      setListening(false);
    }
  };

  const stopVoice = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="voice-cell">
      <input
        ref={inputRef}
        key={`${day}-${shop}-${amount}`}
        className="amount-cell-input"
        defaultValue={amount || ""}
        inputMode="decimal"
        placeholder="0"
        aria-label={`${day}日${shop}金额`}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => {
          const changed = onChange(day, shop, event.currentTarget.value);
          if (!changed) {
            event.currentTarget.value = amount ? String(amount) : "";
          }
        }}
      />
      <button
        type="button"
        className={`voice-cell-btn ${listening ? "voice-listening" : ""}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={listening ? stopVoice : startVoice}
        aria-label="语音输入金额"
        title="语音输入"
      >
        {listening ? "●" : "🎤"}
      </button>
      {interim && <span className="voice-feedback">{interim}</span>}
    </div>
  );
}
