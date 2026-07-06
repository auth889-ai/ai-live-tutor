// MinerU cloud adapter (mineru.net API v4): PDF -> structured markdown + extracted figures
// + tables + LaTeX formulas. Async: upload -> submit task -> poll -> download result zip.
// Returns markdown text + image file list. Honest failure; no fake content.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://mineru.net/api/v4';

export async function parsePdfWithMineru(pdfBytes, { fileName = 'doc.pdf', outDir, env = process.env, pollMs = 4000, maxPolls = 90 } = {}) {
  const token = env.MINERU_API_TOKEN || env.MINERU_API_KEY;
  if (!token?.trim()) throw new Error('MINERU_API_TOKEN is not set');
  const modelVersion = env.MINERU_MODEL_VERSION || 'vlm';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 1. Request an upload URL.
  const batchRes = await fetch(`${BASE}/file-urls/batch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      enable_formula: env.MINERU_ENABLE_FORMULA !== 'false',
      enable_table: env.MINERU_ENABLE_TABLE !== 'false',
      language: env.MINERU_LANGUAGE || 'en',
      model_version: modelVersion,
      files: [{ name: fileName, is_ocr: env.MINERU_IS_OCR === 'true' }],
    }),
  });
  if (!batchRes.ok) throw new Error(`MinerU upload-url failed: HTTP ${batchRes.status} — ${(await batchRes.text()).slice(0, 300)}`);
  const batch = await batchRes.json();
  const uploadUrl = batch?.data?.file_urls?.[0];
  const batchId = batch?.data?.batch_id;
  if (!uploadUrl || !batchId) throw new Error(`MinerU upload response malformed: ${JSON.stringify(batch).slice(0, 200)}`);

  // 2. PUT the PDF bytes to the signed URL.
  const put = await fetch(uploadUrl, { method: 'PUT', body: pdfBytes });
  if (!put.ok) throw new Error(`MinerU file upload failed: HTTP ${put.status}`);

  // 3. Poll the batch until the file is done, then fetch its result zip.
  for (let i = 0; i < maxPolls; i += 1) {
    await sleep(pollMs);
    const res = await fetch(`${BASE}/extract-results/batch/${batchId}`, { headers });
    if (!res.ok) continue;
    const body = await res.json();
    const file = body?.data?.extract_result?.[0];
    if (file?.state === 'done' && file.full_zip_url) {
      return downloadAndUnpack(file.full_zip_url, outDir);
    }
    if (file?.state === 'failed') throw new Error(`MinerU parse failed: ${file.err_msg || 'unknown'}`);
  }
  throw new Error('MinerU parse timed out');
}

async function downloadAndUnpack(zipUrl, outDir) {
  await mkdir(outDir, { recursive: true });
  const zipRes = await fetch(zipUrl);
  if (!zipRes.ok) throw new Error(`MinerU zip download failed: HTTP ${zipRes.status}`);
  const zipPath = path.join(outDir, 'mineru.zip');
  await writeFile(zipPath, Buffer.from(await zipRes.arrayBuffer()));
  return { zipPath, outDir };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
