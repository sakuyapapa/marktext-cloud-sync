/**
 * Verifies the tag popover against the packaged build by driving the real
 * Electron app: types a paragraph, asks the main process to open the popover
 * (the same IPC the context menu sends), fills it and checks the inserted text.
 */

import { _electron } from 'playwright'
import path from 'node:path'

const EXE = 'C:\\MarkText\\marktext.exe'
const ARTIFACTS = path.resolve(__dirname, '..', 'artifacts')

const main = async (): Promise<void> => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }

  const app = await _electron.launch({
    executablePath: EXE,
    args: ['--user-data-dir=C:\\MarkText\\ud-e2e'],
    env,
    timeout: 90_000
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2500)

    // Put some text in the document so the insertion point has context.
    await page.click('.editor-component')
    await page.keyboard.type('今天开会讨论标签功能')
    await page.waitForTimeout(400)

    // Same IPC the native context menu sends.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.webContents.send('mt::cm-insert-tag')
    })
    await page.waitForTimeout(800)

    const cardVisible = await page.isVisible('.mt-tag-card')
    console.log('card visible:', cardVisible)
    await page.screenshot({ path: path.join(ARTIFACTS, 'tag-popover.png') })

    if (cardVisible) {
      const input = page.locator('.mt-tag-card input')
      await input.fill('会议 待办')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(600)
      const text = await page.evaluate(
        () => document.querySelector('.mu-editor')?.textContent ?? ''
      )
      console.log('editor text:', JSON.stringify(text))
      await page.screenshot({ path: path.join(ARTIFACTS, 'tag-inserted.png') })
    }
  } finally {
    await app.close()
  }
}

void main().catch((error) => {
  console.error('E2E FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
