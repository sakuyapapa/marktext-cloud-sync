const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
  const ctx = browser.contexts()[0];
  const editor = ctx.pages().find(p => p.url().includes("type=editor"));
  const cfg = await editor.evaluate(() => window.electron.ipcRenderer.invoke("mt::sync::get-config"));
  console.log("cfg:", JSON.stringify({ provider: cfg.provider, workspace: cfg.workspaceDir, remote: cfg.git.remoteUrl, branch: cfg.git.branch, enabled: cfg.enabled }));
  const status = await editor.evaluate(() => window.electron.ipcRenderer.invoke("mt::sync::run"));
  console.log("sync:", JSON.stringify(status.lastResult), status.phase, status.message);
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
