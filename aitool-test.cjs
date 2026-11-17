const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes("type=editor"));

  await page.evaluate(async () => {
    await window.electron.ipcRenderer.invoke("mt::ai::set-config", {
      enabled: true,
      baseUrl: "http://127.0.0.1:8790/v1",
      model: "mock",
      apiKey: "k",
      temperature: 0.2,
      maxTokens: 512
    });
    await window.electron.ipcRenderer.invoke("mt::sync::set-config", {
      provider: "git",
      workspaceDir: "C:\\Users\\Administrator\\Documents\\deepseek-harness\\default-workspace\\marktext-notes",
      enabled: false,
      git: {
        remoteUrl: "git@github.com:sakuyapapa/note.git",
        branch: "main",
        userName: "meilz",
        userEmail: "meilz@kmsoft.com.cn"
      }
    });
  });

  const done = await page.evaluate(() => new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ error: "timeout" }), 90000);
    window.electron.ipcRenderer.once("mt::ai::done", (_e, payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
    window.electron.ipcRenderer.send("mt::ai::start", {
      requestId: "test-pull-" + Date.now(),
      action: "chat",
      selection: "",
      instruction: "把云端最新的文档拉下来"
    });
  }));
  console.log("done:", JSON.stringify(done).slice(0, 500));
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
