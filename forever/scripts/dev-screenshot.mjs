import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
await page.goto('http://localhost:3000/dev/lenses', { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
await page.waitForTimeout(3500);
// Tarjan is the first card: drive its slider to a late step (low-rewrites done) and shoot it.
const slider = page.locator('section input[type="range"]').first();
await slider.focus();
for (let i = 0; i < 24; i += 1) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(60); }
await page.waitForTimeout(1500);
await page.locator('section').first().screenshot({ path: '/tmp/shot-tarjan.png' });
console.log('tarjan nodeState shot saved');
await browser.close();
