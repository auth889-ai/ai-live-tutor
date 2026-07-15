import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto('http://localhost:3000/course/lesson_spa312d1db32bf', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3000);
const dry = page.locator('text=Dry Run').first();
if (await dry.count()) { await dry.click(); await page.waitForTimeout(1500); }
await page.keyboard.press('Space').catch(() => {});
// seek deep: the trace panel enters after the framing objects
const plus = page.locator('button', { hasText: '+10s' }).first();
for (let i = 0; i < 22; i += 1) { await plus.click().catch(() => {}); await page.waitForTimeout(150); }
await page.waitForTimeout(4000);
await page.screenshot({ path: '/tmp/shot-cockpit2.png' });
console.log('deep cockpit shot taken');
await browser.close();
