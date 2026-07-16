import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1150 } });
await page.goto('http://localhost:3000/course/lesson_spb7f51058f4c3', { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
await page.waitForTimeout(3500);
const dry = page.locator('text=Dry Run: Tarjan').first();
if (await dry.count()) { await dry.click(); await page.waitForTimeout(2000); }
// Start playback and jump into the middle of the dry run so the cockpit is mounted.
await page.keyboard.press('Space').catch(() => {});
const plus = page.locator('button', { hasText: '+10s' }).first();
for (let i = 0; i < 20; i += 1) { await plus.click().catch(() => {}); await page.waitForTimeout(150); }
await page.waitForTimeout(2500);
// Then explore-step so a low-rewrite moment is on screen.
const next = page.locator('button[title="Next step (→)"]').first();
for (let i = 0; i < 8; i += 1) { await next.click().catch(() => {}); await page.waitForTimeout(100); }
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/shot-tarjan-app2.png' });
console.log('real-app tarjan mid-playback shot saved');
await browser.close();
