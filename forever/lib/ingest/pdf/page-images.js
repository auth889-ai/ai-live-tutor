// Render each PDF page to ONE exact full-page PNG (poppler pdftocairo, pdftoppm fallback) —
// so the vision model can SEE the whole page and images are never separated from context.
// Ported from the old server's proven approach; Puppeteer/browser screenshots are BANNED
// (they capture viewer chrome and repeat pages).

import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function renderPageImages(pdfPath, { outDir, dpi = 150, timeoutMs = 120_000 } = {}) {
  await mkdir(outDir, { recursive: true });
  const prefix = path.join(outDir, 'page');
  const tools = [
    { cmd: 'pdftocairo', args: ['-png', '-r', String(dpi), pdfPath, prefix] },
    { cmd: 'pdftoppm', args: ['-png', '-r', String(dpi), pdfPath, prefix] },
  ];

  let lastError;
  for (const tool of tools) {
    try {
      await run(tool.cmd, tool.args, timeoutMs);
      const files = (await readdir(outDir)).filter((f) => f.endsWith('.png')).sort();
      if (files.length) {
        return files.map((file, index) => ({ page: index + 1, path: path.join(outDir, file) }));
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Page-image render failed (install poppler: brew install poppler). ${lastError?.message ?? ''}`);
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { timeout: timeoutMs });
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (e) => reject(e.code === 'ENOENT' ? new Error(`${cmd} not installed`) : e));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${stderr.slice(0, 200)}`))));
  });
}
