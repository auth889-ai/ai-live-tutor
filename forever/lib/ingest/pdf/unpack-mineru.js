// Unpack a MinerU result zip: extract it, read the markdown (the structured text of the
// PDF), and list the extracted figures. Slice 1 uses the markdown; slice 2 uses the images
// (vision pass -> teach from figures).

import { spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export async function unpackMineru(zipPath, outDir) {
  await runUnzip(zipPath, outDir);
  const files = await walk(outDir);

  // The main markdown is the largest .md file MinerU produced.
  const mdFiles = files.filter((f) => f.toLowerCase().endsWith('.md'));
  if (mdFiles.length === 0) throw new Error('MinerU result contained no markdown');
  let markdownPath = mdFiles[0];
  let best = 0;
  for (const f of mdFiles) {
    const size = (await stat(f)).size;
    if (size > best) {
      best = size;
      markdownPath = f;
    }
  }
  const markdown = await readFile(markdownPath, 'utf8');
  const images = files
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .map((f, index) => ({ id: `fig_${String(index + 1).padStart(3, '0')}`, kind: 'figure', path: f, name: path.basename(f) }));

  return { markdown, images };
}

function runUnzip(zipPath, outDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-o', zipPath, '-d', outDir]);
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`unzip failed: ${stderr.slice(0, 200)}`))));
  });
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}
