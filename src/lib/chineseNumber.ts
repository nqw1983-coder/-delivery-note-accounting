/**
 * 把中文/口语数字转成阿拉伯数字。
 *
 * 处理场景(送货单常见):
 * - "238" → 238
 * - "二百三十八" → 238
 * - "一千二" → 1200
 * - "三万五" → 35000
 * - "六十六块" → 66
 * - "六十六点五" → 66.5
 * - "三十五块六" → 35.6
 *
 * Web Speech API (zh-CN) 在大多数情况下会直接给阿拉伯数字,但偶尔会返回中文,
 * 所以两种格式都处理。
 */

const DIGITS: Record<string, number> = {
  "零": 0, "○": 0, "〇": 0,
  "一": 1, "壹": 1, "幺": 1,
  "二": 2, "贰": 2, "两": 2,
  "三": 3, "叁": 3,
  "四": 4, "肆": 4,
  "五": 5, "伍": 5,
  "六": 6, "陆": 6,
  "七": 7, "柒": 7,
  "八": 8, "捌": 8,
  "九": 9, "玖": 9,
};

const UNITS: Record<string, number> = {
  "十": 10, "拾": 10,
  "百": 100, "佰": 100,
  "千": 1000, "仟": 1000,
  "万": 10000, "萬": 10000,
};

/** 把纯中文数字字符串转成数字。"二百三十八" → 238 */
function parseChineseInt(s: string): number | null {
  let total = 0;
  let current = 0;
  let hasAny = false;
  for (const ch of s) {
    if (ch in DIGITS) {
      current = current * 10 + DIGITS[ch];
      hasAny = true;
    } else if (ch in UNITS) {
      const unit = UNITS[ch];
      if (current === 0) current = 1;
      if (unit >= 10000) {
        total = (total + current) * unit;
      } else {
        total += current * unit;
      }
      current = 0;
      hasAny = true;
    }
  }
  if (!hasAny) return null;
  return total + current;
}

/** 主入口:从语音识别返回的字符串中提取数字(支持小数) */
export function extractAmount(raw: string): number | null {
  if (!raw) return null;
  const text = raw.trim();

  // 1) 直接是阿拉伯数字(Web Speech API 大多数返回这种)
  const arabicMatch = text.match(/(-?\d+(?:[.,]\d+)?)/);
  if (arabicMatch) {
    const num = parseFloat(arabicMatch[1].replace(",", "."));
    if (!Number.isNaN(num)) return num;
  }

  // 2) 处理"X 块/元 Y 毛/角"格式
  //    "三十五块六" → 35.6;"六十六块" → 66
  const yuanFenMatch = text.match(/^(.+?)[块元圆](.+)?$/);
  if (yuanFenMatch) {
    const yuan = parseChineseInt(yuanFenMatch[1]);
    const fenStr = (yuanFenMatch[2] || "").replace(/[毛角分钱整]/g, "");
    if (yuan !== null) {
      if (fenStr) {
        const fen = parseChineseInt(fenStr);
        if (fen !== null) return yuan + fen / 10;
      }
      return yuan;
    }
  }

  // 3) 处理"X 点 Y"格式 → X.Y
  const dotMatch = text.match(/^(.+?)[点點\.](.+)$/);
  if (dotMatch) {
    const int = parseChineseInt(dotMatch[1]);
    // 小数部分按位读:"三点五六" = 3.56
    let frac = "";
    for (const ch of dotMatch[2]) {
      if (ch in DIGITS) frac += DIGITS[ch];
    }
    if (int !== null && frac) return parseFloat(`${int}.${frac}`);
    if (int !== null) return int;
  }

  // 4) 兜底:纯中文整数
  const intVal = parseChineseInt(text);
  return intVal;
}
