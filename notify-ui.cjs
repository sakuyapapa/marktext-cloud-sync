const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes("type=editor"));
  // 复现 quickSync 下发的两条通知（同样的 payload）
  await page.evaluate(() => window.electron.ipcRenderer.send("mt::show-notification", {
    title: "同步", message: "正在同步到 Git…", type: "info", time: 12000
  }));
  await page.waitForTimeout(700);
  await page.screenshot({ path: "C:\\Users\\Administrator\\Documents\\deepseek-harness\\default-workspace\\artifacts\\sync-notify-running.png" });
  await page.evaluate(() => {
    [...document.querySelectorAll(".el-notification__closeBtn")].forEach((b) => b.click());
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.electron.ipcRenderer.send("mt::show-notification", {
    title: "同步", message: "已同步到 Git：上传 1，下载 2，冲突 0（已另存副本）", type: "primary", time: 12000
  }));
  await page.waitForTimeout(700);
  await page.screenshot({ path: "C:\\Users\\Administrator\\Documents\\deepseek-harness\\default-workspace\\artifacts\\sync-notify-done.png" });
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
