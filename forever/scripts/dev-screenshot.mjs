import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1250 } });
await page.goto('http://localhost:3000/dev/lenses', { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
await page.waitForTimeout(3500);
const cards = page.locator('section');
const n = await cards.count();
for (let i = 0; i < n; i += 1) {
  const txt = await cards.nth(i).locator('h2').innerText().catch(() => '');
  if (txt.includes('tarjan')) {
    const slider = cards.nth(i).locator('input').first();
    await slider.focus();
    for (let k = 0; k < 30; k += 1) await page.keyboard.press('ArrowLeft');
    for (let k = 0; k < 11; k += 1) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(50); }
    await page.waitForTimeout(1500);
    await cards.nth(i).screenshot({ path: '/tmp/shot-stage-frames.png' });
    console.log('saved');
    break;
  }
}
await browser.close();
