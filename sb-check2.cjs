const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
  const ctx = browser.contexts()[0];
  const editor = ctx.pages().find(p => p.url().includes("type=editor"));
  await editor.click(".editor-component");
  await editor.keyboard.type("插入测试");
  await editor.keyboard.press("Control+a");
  await editor.evaluate(() => window.electron.ipcRenderer.invoke("mt::note::create-and-open"));
  await new Promise(r => setTimeout(r, 2200));
  const note = ctx.pages().find(p => p.url().includes("note.html"));
  await note.fill("#name", "周会");
  await note.fill("#tag", "#周会");
  await note.fill("#note", "第一行\n第二行");
  await note.click("#insert");
  await new Promise(r => setTimeout(r, 1500));
  const value = await editor.evaluate(() => {
    const el = document.querySelector(".mu-editor");
    return { text: el ? el.textContent : "", paragraphs: [...document.querySelectorAll(".mu-paragraph")].map(p => p.textContent) };
  });
  console.log(JSON.stringify(value));
  await editor.screenshot({ path: "C:\\Users\\Administrator\\Documents\\deepseek-harness\\default-workspace\\artifacts\\note-inserted.png" });
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
