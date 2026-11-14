import { chromium } from 'playwright'

const main = async (): Promise<void> => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
  try {
    const context = browser.contexts()[0]
    const page =
      context.pages().find((candidate) => candidate.url().includes('index.html')) ?? context.pages()[0]
    if (!page) throw new Error('no page')
    const state = await page.evaluate(() => {
      const card = document.querySelector('.mt-tag-card') as HTMLElement | null
      const layer = document.querySelector('.mt-tag-layer') as HTMLElement | null
      return {
        hasCard: !!card,
        hasLayer: !!layer,
        cardRect: card ? card.getBoundingClientRect().toJSON() : null,
        activeTag: document.activeElement?.tagName ?? null
      }
    })
    console.log('state:', JSON.stringify(state))
    await page.screenshot({ path: 'C:\\MarkText\\menu-check.png' })
  } finally {
    await browser.close()
  }
}

void main().catch((error) => {
  console.error('FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
