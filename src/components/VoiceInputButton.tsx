import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { extractAmount } from "../lib/chineseNumber";

interface VoiceInputButtonProps {
  selectedCell: { day: number; shop: string } | null;
  /** 调用 App.handleMonthCellChange,返回是否成功 */
  onChange: (day: number, shop: string, value: string) => boolean;
}

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

export function VoiceInputButton({ selectedCell, onChange }: VoiceInputButtonProps) {
  const [listening, setListening] = useState(false);
  const [feedback, setFeedback] = useState<string>("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const showFeedback = (msg: string, kind: "success" | "warn" | "info" = "info") => {
    setFeedback(`__${kind}__${msg}`);
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(""), 3000);
  };

  const startVoice = () => {
    if (!selectedCell) {
      showFeedback("请先点表格里某个格子(选中后再点麦克风)", "warn");
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      showFeedback("此浏览器不支持语音(请用 Safari/Chrome)", "warn");
      return;
    }
    const rec = new Ctor();
    rec.lang = "zh-CN";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setListening(true);
      showFeedback(`听 ${selectedCell.shop} ${selectedCell.day}日 ...`, "info");
    };
    rec.onend = () => {
      setListening(false);
    };
    rec.onerror = (event) => {
      console.warn("[voice] error:", event.error);
      setListening(false);
      if (event.error === "not-allowed") {
        showFeedback("麦克风被拒。设置 → Safari → 麦克风 → 允许", "warn");
      } else if (event.error === "no-speech") {
        showFeedback("没听到声音,再试一次", "warn");
      } else {
        showFeedback(`识别失败: ${event.error}`, "warn");
      }
    };
    rec.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const num = extractAmount(transcript);
      if (num !== null && num > 0 && selectedCell) {
        const changed = onChange(selectedCell.day, selectedCell.shop, String(num));
        if (changed) {
          showFeedback(`✓ ${selectedCell.shop} ${selectedCell.day}日 = ${num}`, "success");
        } else {
          showFeedback("保存失败,请重试", "warn");
        }
      } else {
        showFeedback(`听到"${transcript}",未识别到金额`, "warn");
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
    } catch (err) {
      console.warn("[voice] start failed:", err);
      setListening(false);
      showFeedback("启动失败,请重试", "warn");
    }
  };

  const stopVoice = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
  };

  const buttonLabel = listening
    ? "停止"
    : selectedCell
      ? `🎤 ${selectedCell.shop} ${selectedCell.day}日`
      : "🎤 语音录入";

  const feedbackKind = feedback.startsWith("__success__")
    ? "success"
    : feedback.startsWith("__warn__")
      ? "warn"
      : "info";
  const feedbackText = feedback.replace(/^__(success|warn|info)__/, "");

  return (
    <div className="voice-input-bar">
      <button
        type="button"
        className={`voice-input-btn ${listening ? "is-listening" : ""} ${!selectedCell ? "is-disabled" : ""}`}
        onClick={listening ? stopVoice : startVoice}
        aria-label="语音输入金额"
        title={selectedCell ? `语音录入 ${selectedCell.shop} ${selectedCell.day}日金额` : "请先选中表格里某个格子"}
      >
        {listening ? <MicOff size={18} /> : <Mic size={18} />}
        <span>{buttonLabel}</span>
      </button>
      {feedback && (
        <span className={`voice-feedback-bar voice-feedback-${feedbackKind}`}>
          {feedbackText}
        </span>
      )}
    </div>
  );
}
