import fs from 'node:fs';
import path from 'node:path';
import { MAX_CRAWL_FILE_BYTES, CRAWL_UPLOAD_PART_BYTES } from '../src/lib/crawl-upload-limits.mjs';

export async function uploadMultipartFile(filePath, username, siteUrl, apiKey, fetchImpl = fetch) {
  const size = fs.statSync(filePath).size;
  if (size <= 0 || size > MAX_CRAWL_FILE_BYTES) throw new Error('File exceeds the 1 GB upload limit or is empty');
  const key = `${username}_${path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  let uploadId = '';
  async function request(action, options = {}, partNumber) {
    const params = new URLSearchParams({ action, size: String(size), key });
    if (uploadId) params.set('uploadId', uploadId);
    if (partNumber) params.set('partNumber', String(partNumber));
    const response = await fetchImpl(`${siteUrl}/api/crawl-upload-file?${params}`, {
      method: 'POST', ...options,
      headers: { 'X-API-Key': apiKey, ...options.headers },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} - ${await response.text()}`);
    return await response.json();
  }
  const created = await request('create');
  if (created.exists) return created.key;
  uploadId = created.uploadId;
  if (!uploadId) throw new Error('Multipart upload returned no uploadId');
  const file = await fs.promises.open(filePath, 'r');
  try {
    const parts = [];
    for (let offset = 0; offset < size; offset += CRAWL_UPLOAD_PART_BYTES) {
      const body = Buffer.alloc(Math.min(CRAWL_UPLOAD_PART_BYTES, size - offset));
      const { bytesRead } = await file.read(body, 0, body.length, offset);
      if (bytesRead !== body.length) throw new Error('File changed during upload');
      const partNumber = parts.length + 1;
      let uploaded;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          uploaded = await request('part', {
            method: 'PUT', body,
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length) },
          }, partNumber);
          break;
        } catch (err) { if (attempt === 2) throw err; }
      }
      parts.push(uploaded);
    }
    return (await request('complete', {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parts }),
    })).key;
  } catch (err) {
    await request('abort').catch(() => {});
    throw err;
  } finally {
    await file.close();
  }
}
