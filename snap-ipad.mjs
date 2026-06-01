import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: { width: 1180, height: 820 },  // iPad landscape 11"
});
const page = await browser.newPage();

await page.goto("http://localhost:4173", { waitUntil: "networkidle2" });
await page.waitForSelector('input[type="password"]', { timeout: 10000 });
await page.type('input[type="password"]', "niequanwei1983");
await page.click('button[type="submit"]');
await new Promise(r => setTimeout(r, 4000));

await page.screenshot({ path: "/tmp/ipad-mockup.png", fullPage: false });
console.log("截图: /tmp/ipad-mockup.png");

await browser.close();
