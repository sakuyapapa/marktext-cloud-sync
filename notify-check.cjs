const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
  const ctx = browser.contexts()[0];
  const editor = ctx.pages().find(p => p.url().includes("type=editor"));
  const status = await editor.evaluate(() => window.electron.ipcRenderer.invoke("mt::sync::run"));
  console.log("sync phase:", status.phase, "| result:", JSON.stringify(status.lastResult));
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
