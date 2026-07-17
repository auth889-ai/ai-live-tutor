import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: 'forever_session', value: 'eyJ1c2VySWQiOiJ1c2VyXzkwNGZkZTE0LTY3MGQtNDgyMC1iMjQ1LTRiNzE2ODcyZDYwMCIsImVtYWlsIjoic3R1ZHl0ZXN0QHQuZGV2IiwiZXhwIjoxNzg0ODk2MDM5OTQ4fQ.VX5cZDs5pYH-rIX8ROW6-BNg46-xajcrYSvvC3SORTE', domain: 'localhost', path: '/' }]);
const page = await ctx.newPage();
for (const [path, out] of [['/progress', '/tmp/shot-progress.png'], ['/bookmarks', '/tmp/shot-bookmarks.png'], ['/dashboard', '/tmp/shot-dash.png']]) {
  await page.goto('http://localhost:3000' + path, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: out });
  console.log('shot', path);
}
await browser.close();
