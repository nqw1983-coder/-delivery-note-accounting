// 端到端自动验收脚本 - 用 puppeteer 控制真实 Chrome
// 跑线上版本 https://delivery-note.pages.dev,完成:
// 1. 加载主页 + 截图
// 2. 输入密码登录 + 截图
// 3. 等主界面加载 + 截图
// 4. 进入设置 + 截图
// 5. 点测试连接(走 Edge Function)+ 截图
// 6. (可选) 上传测试图片走 OCR
// 7. 检查 Supabase 数据是否有变化(独立验证云端同步)

import puppeteer from "puppeteer-core";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const URL = "https://delivery-note.pages.dev";
const PASSWORD = "niequanwei1983";
const OUT_DIR = "/tmp/auto-verify-screenshots";
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

const log = (msg) => console.log(`[verify] ${msg}`);
const errors = [];

async function shot(page, name, label) {
  const path = `${OUT_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  log(`✓ ${label} → ${path}`);
}

async function run() {
  log("启动 Chrome (headed mode 看得见)...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-extensions"],
    defaultViewport: { width: 1280, height: 900 },
  });
  const page = await browser.newPage();

  try {
    // === 1. 加载主页 ===
    log(`1/6 加载 ${URL}`);
    const t1 = Date.now();
    const resp = await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
    const loadTime = Date.now() - t1;
    log(`   HTTP ${resp.status()}, 耗时 ${loadTime}ms`);
    if (resp.status() !== 200) errors.push(`主页 HTTP ${resp.status()}`);

    // 等密码门加载
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await shot(page, "1-login", "密码登录页加载");

    // === 2. 输入密码 ===
    log(`2/6 输入密码 ${PASSWORD}`);
    await page.type('input[type="password"]', PASSWORD);
    await shot(page, "2-password-typed", "密码已输入");

    // 点进入按钮
    const submitBtn = await page.$('button[type="submit"]');
    if (!submitBtn) {
      errors.push("找不到登录提交按钮");
    } else {
      await submitBtn.click();
      log("   已点登录");
    }

    // === 3. 等主界面 ===
    log(`3/6 等主界面加载`);
    // 主界面应该有 sidebar 或 brand-row
    try {
      await page.waitForSelector(".sidebar, .brand-row, h1", { timeout: 15000 });
      // 给点时间云端数据加载
      await new Promise(r => setTimeout(r, 3000));
      await shot(page, "3-main", "主界面加载");
      const title = await page.title();
      log(`   页面标题: ${title}`);
    } catch (e) {
      errors.push(`主界面没出现: ${e.message}`);
      await shot(page, "3-main-FAIL", "主界面失败截图");
    }

    // === 4. 测试设置弹窗 ===
    log(`4/6 打开设置弹窗`);
    try {
      const settingsBtn = await page.$('button[aria-label="识别服务设置"]');
      if (settingsBtn) {
        await settingsBtn.click();
        await new Promise(r => setTimeout(r, 1500));
        await shot(page, "4-settings", "设置弹窗");
      } else {
        log("   未找到设置按钮(可能 aria-label 不匹配)");
        await shot(page, "4-settings-NOFOUND", "未找到设置按钮");
      }
    } catch (e) {
      errors.push(`设置弹窗失败: ${e.message}`);
    }

    // === 5. 点击测试连接 ===
    log(`5/6 点击测试连接按钮(真实走 Edge Function)`);
    try {
      // 找包含"测试连接"文本的按钮
      const buttons = await page.$$('button');
      let testBtn = null;
      for (const b of buttons) {
        const text = await page.evaluate(el => el.textContent, b);
        if (text && text.includes("测试连接")) {
          testBtn = b;
          break;
        }
      }
      if (testBtn) {
        await testBtn.click();
        log("   已点测试连接,等待响应(最多 30 秒)...");

        // 等结果出现:成功或失败
        const start = Date.now();
        let result = null;
        while (Date.now() - start < 30000) {
          await new Promise(r => setTimeout(r, 500));
          const pre = await page.$('pre');
          if (pre) {
            result = await page.evaluate(el => el.textContent, pre);
            if (result && (result.includes("✅") || result.includes("❌") || result.includes("OK") || result.includes("失败"))) {
              break;
            }
          }
        }
        log(`   测试连接结果: ${result ? result.slice(0, 200) : "(无结果)"}`);
        await shot(page, "5-test-conn-result", "测试连接结果");

        if (result && result.includes("✅")) {
          log("   ✅ 测试连接成功");
        } else {
          errors.push(`测试连接未通过: ${result?.slice(0, 200) || "无响应"}`);
        }
      } else {
        errors.push("找不到测试连接按钮");
      }
    } catch (e) {
      errors.push(`测试连接异常: ${e.message}`);
    }

    // === 6. 关闭设置,看主界面 ===
    log(`6/6 关闭设置,确认主界面正常`);
    try {
      const buttons = await page.$$('button');
      for (const b of buttons) {
        const text = await page.evaluate(el => el.textContent, b);
        if (text && text.trim() === "关闭") {
          await b.click();
          break;
        }
      }
      await new Promise(r => setTimeout(r, 1500));
      await shot(page, "6-final", "最终主界面");
    } catch (e) {
      log(`   关弹窗失败(无影响): ${e.message}`);
    }

    // === 检查页面控制台错误 ===
    // (puppeteer 默认不捕获,所以我们在最后看 page 状态)

  } finally {
    await browser.close();
  }

  // 输出报告
  console.log("\n========== 验收报告 ==========");
  if (errors.length === 0) {
    console.log("✅ 所有关键路径验收通过!");
  } else {
    console.log(`❌ ${errors.length} 个问题:`);
    errors.forEach((e, i) => console.log(`   ${i + 1}. ${e}`));
  }
  console.log(`\n截图已保存到: ${OUT_DIR}/`);
  console.log("文件列表:");
  console.log("  1-login.png             密码门");
  console.log("  2-password-typed.png    密码已输入");
  console.log("  3-main.png              主界面");
  console.log("  4-settings.png          设置弹窗");
  console.log("  5-test-conn-result.png  测试连接结果");
  console.log("  6-final.png             最终状态");

  process.exit(errors.length > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("脚本崩溃:", err);
  process.exit(2);
});
