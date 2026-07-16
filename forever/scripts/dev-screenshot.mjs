import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.goto('http://localhost:3000/dev/cockpit', { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
await page.waitForTimeout(3500);
// Drive the slider to a mid-DFS step where the stack is deep and low-rewrites happened.
const slider = page.locator('input[type="range"]').first();
await slider.focus();
for (let i = 0; i < 24; i += 1) { await page.keyboard.press('ArrowLeft'); }
for (let i = 0; i < 13; i += 1) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(60); }
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/shot-cockpit.png' });
console.log('cockpit fixture shot saved');
await browser.close();
