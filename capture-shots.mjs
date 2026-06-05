import puppeteer from "puppeteer-core";

const CHROME = "/Users/nqw1983163.com/.cache/puppeteer/chrome/mac_arm-149.0.7827.22/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = "http://localhost:5173/";
const OUT = "/Users/nqw1983163.com/Documents/送货单记账简化版/mockups";
const PW = "niequanwei1983";

const IPHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const IPAD_L = { width: 1112, height: 834, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const IPAD_P = { width: 834, height: 1112, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const MAC = { width: 1440, height: 900, deviceScaleFactor: 2, isMobile: false, hasTouch: false };

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPAD_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page) {
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(600);
  const hasPw = await page.$('input[type="password"]');
  if (hasPw) {
    await page.type('input[type="password"]', PW);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("进入"));
      b && b.click();
    });
    await sleep(1200);
  }
}

async function clickText(page, text, tagPref) {
  await page.evaluate((t) => {
    const all = [...document.querySelectorAll("*")].filter((e) => e.children.length <= 4 && new RegExp(t).test(e.textContent));
    const el = all[all.length - 1];
    el && el.click();
  }, text);
}

async function newPage(browser, vp, ua, realIPad = false) {
  const page = await browser.newPage();
  await page.setUserAgent(ua);
  await page.setViewport(vp);
  if (realIPad) {
    // 真实 iPad Safari 上报 maxTouchPoints=5;headless Chrome 只给 1。
    // 注入 5 忠实模拟真机,验证 isModernIPad (maxTouchPoints>1) 分支。
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
    });
  }
  return page;
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

// 1. iPhone day detail
{
  const page = await newPage(browser, IPHONE, IPHONE_UA);
  await login(page);
  await clickText(page, "2026年5月");
  await sleep(800);
  await page.screenshot({ path: `${OUT}/shot-iphone-daydetail.png` });
  await page.close();
  console.log("iphone-daydetail done");
}

// 2. iPhone payment
{
  const page = await newPage(browser, IPHONE, IPHONE_UA);
  await login(page);
  await clickText(page, "店铺收款确认");
  await sleep(800);
  await page.screenshot({ path: `${OUT}/shot-iphone-payment.png` });
  await page.close();
  console.log("iphone-payment done");
}

// 3. iPad landscape month list
{
  const page = await newPage(browser, IPAD_L, IPAD_UA, true);
  await login(page);
  await sleep(500);
  await page.screenshot({ path: `${OUT}/shot-ipad-landscape-monthlist.png` });
  console.log("ipad-landscape-monthlist done");
  // 4. iPad landscape payment
  await clickText(page, "店铺收款确认");
  await sleep(800);
  await page.screenshot({ path: `${OUT}/shot-ipad-landscape-payment.png` });
  await page.close();
  console.log("ipad-landscape-payment done");
}

// 5. iPad portrait month list
{
  const page = await newPage(browser, IPAD_P, IPAD_UA);
  await login(page);
  await sleep(500);
  await page.screenshot({ path: `${OUT}/shot-ipad-portrait-monthlist.png` });
  await page.close();
  console.log("ipad-portrait-monthlist done");
}

// 6. Mac desktop table
{
  const page = await newPage(browser, MAC, MAC_UA);
  await login(page);
  await sleep(800);
  await page.screenshot({ path: `${OUT}/shot-mac-desktop-table.png` });
  await page.close();
  console.log("mac-desktop-table done");
}

await browser.close();
console.log("ALL DONE");
