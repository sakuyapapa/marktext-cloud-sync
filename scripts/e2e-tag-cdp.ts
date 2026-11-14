/**
 * Same check as e2e-tag.ts but attaches over CDP to an already running app,
 * because Playwright cannot spawn Electron in this environment.
 *
 *   marktext.exe --remote-debugging-port=9333 --user-data-dir=... 
 */

import { chromium } from 'playwright'
import path from 'node:path'

const ARTIFACTS = path.resolve(__dirname, '..', 'artifacts')

const main = async (): Promise<void> => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
  const context = browser.contexts()[0]
  const page = context.pages().find((candidate) => candidate.url().includes('index.html')) ?? context.pages()[0]
  if (!page) throw new Error('no renderer page found')

  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1500)

  await page.click('.editor-component')
  await page.keyboard.type('今天开会讨论标签功能')
  await page.waitForTimeout(400)

  // Same code path as the 标签… menu item, driven by the in-app shortcut.
  await page.keyboard.press('Control+Alt+KeyT')
  await page.waitForTimeout(800)

  const cardVisible = await page.isVisible('.mt-tag-card')
  console.log('card visible:', cardVisible)
  await page.screenshot({ path: path.join(ARTIFACTS, 'tag-popover.png') })

  if (cardVisible) {
    const input = page.locator('.mt-tag-card input')
    await input.fill('会议 待办')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(700)
    const text = await page.evaluate(() => document.querySelector('.mu-editor')?.textContent ?? '')
    console.log('editor text:', JSON.stringify(text))
    await page.screenshot({ path: path.join(ARTIFACTS, 'tag-inserted.png') })
  }

  await browser.close()
}

void main().catch((error) => {
  console.error('CDP E2E FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
