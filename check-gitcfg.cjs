const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
  const ctx = browser.contexts()[0];
  const editor = ctx.pages().find(p => p.url().includes("type=editor"));
  await editor.evaluate(() => window.electron.ipcRenderer.send("mt::open-setting-window"));
  await new Promise(r => setTimeout(r, 2600));
  const settings = ctx.pages().find(p => p.url().includes("type=settings"));
  await settings.evaluate(() => { location.hash = "#/preference/sync"; });
  await settings.waitForTimeout(1800);
  const values = await settings.evaluate(() => {
    const rows = [...document.querySelectorAll(".row")];
    const read = (label) => {
      const row = rows.find(r => (r.querySelector(".row-label")?.textContent || "").trim() === label);
      return row?.querySelector("input")?.value ?? null;
    };
    const select = document.querySelector(".el-select .el-select__selected-item, .el-select .el-select__placeholder");
    return {
      provider: select ? select.textContent.trim() : null,
      remoteUrl: read("仓库地址"),
      branch: read("分支"),
      userName: read("提交者姓名"),
      userEmail: read("提交者邮箱")
    };
  });
  console.log(JSON.stringify(values, null, 1));
  await settings.screenshot({ path: "C:\\Users\\Administrator\\Documents\\deepseek-harness\\default-workspace\\artifacts\\sync-git-config.png" });
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
