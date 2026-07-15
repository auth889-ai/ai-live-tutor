import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:3000/course/lesson_spa312d1db32bf', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(4000);
// open the dry-run scene from the sidebar
const dryRun = page.locator('text=Dry Run').first();
if (await dryRun.count()) { await dryRun.click(); await page.waitForTimeout(2500); }
// press play and let the trace advance a few steps
const play = page.locator('button').filter({ hasText: '' }).first();
await page.keyboard.press('Space').catch(() => {});
await page.waitForTimeout(6000);
await page.screenshot({ path: '/tmp/shot-lc-dryrun.png' });
console.log('shot: lc dry-run scene');
await browser.close();
