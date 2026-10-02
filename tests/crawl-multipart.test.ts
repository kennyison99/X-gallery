import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleCrawlMultipart } from '../src/lib/crawl-multipart.ts';
import { uploadMultipartFile } from '../scripts/crawl-upload.mjs';
import { MAX_CRAWL_FILE_BYTES, CRAWL_UPLOAD_PART_BYTES } from '../src/lib/crawl-upload-limits.mjs';
import { processTweetGroup } from '../scripts/crawl-twitter.mjs';

test('1 GB multipart lifecycle validates limits, parts, aborts, and counts bytes once', async () => {
  const key = 'silva_siufabing_2105577785272225980_1.mp4';
  let stored: { size: number, customMetadata: { crawlSize: string } } | null = null;
  let size = CRAWL_UPLOAD_PART_BYTES + 1024;
  let counted = 0;
  let completed = 0;
  let aborted = 0;
  const received: number[] = [];
  const multipart = {
    uploadId: 'upload-1',
    uploadPart: async (n: number, body: ReadableStream) => {
      received.push((await new Response(body).arrayBuffer()).byteLength);
      return { partNumber: n, etag: `etag-${n}` };
    },
    complete: async () => {
      completed++;
      stored = { size, customMetadata: { crawlSize: String(size) } };
      return stored;
    },
    abort: async () => { aborted++; },
  };
  const bucket = {
    head: async () => stored,
    createMultipartUpload: async () => multipart,
    resumeMultipartUpload: () => multipart,
  } as unknown as R2Bucket;
  const request = (action: string, options: RequestInit = {}, overrides = {}) => {
    const params = new URLSearchParams({ key, size: String(size), uploadId: 'upload-1', action, ...overrides });
    return handleCrawlMultipart(new Request(`https://example.test/api?${params}`, { method: 'POST', ...options }),
      bucket, async () => false, async (n) => { counted += n; });
  };
  assert.equal(MAX_CRAWL_FILE_BYTES, 1_000_000_000);
  assert.equal((await request('create', {}, { size: String(MAX_CRAWL_FILE_BYTES + 1) })).status, 413);
  assert.equal((await request('create', {}, { size: String(MAX_CRAWL_FILE_BYTES) })).status, 200);
  assert.equal((await request('part', { method: 'PUT', body: new Uint8Array(1), headers: { 'Content-Length': '1' } }, { partNumber: '1' })).status, 400);
  for (const [i, bytes] of [CRAWL_UPLOAD_PART_BYTES, 1024].entries()) {
    assert.equal((await request('part', { method: 'PUT', body: new Uint8Array(bytes), headers: { 'Content-Length': String(bytes) } }, { partNumber: String(i + 1) })).status, 200);
  }
  const options = { body: JSON.stringify({ parts: [{ partNumber: 1, etag: 'etag-1' }, { partNumber: 2, etag: 'etag-2' }] }), headers: { 'Content-Type': 'application/json' } };
  assert.equal((await request('complete', { body: '{"parts":[]}' })).status, 400);
  assert.equal((await request('complete', options)).status, 200);
  assert.equal((await request('complete', options)).status, 200);
  assert.equal(completed, 1);
  assert.equal(counted, size);
  assert.deepEqual(received, [CRAWL_UPLOAD_PART_BYTES, 1024]);
  assert.equal((await request('abort')).status, 200);
  assert.equal(aborted, 1);
});

test('crawler uploads bounded chunks, retries parts, and aborts failed uploads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawl-multipart-'));
  const file = path.join(dir, '2105577785272225980_1.mp4');
  fs.writeFileSync(file, Buffer.alloc(CRAWL_UPLOAD_PART_BYTES + 10));
  let fail = false;
  let transientFailure = true;
  let aborted = false;
  const sizes: number[] = [];
  const fetchImpl = async (url: string, options: RequestInit) => {
    const params = new URL(url).searchParams;
    switch (params.get('action')) {
      case 'create': return Response.json({ key: params.get('key'), uploadId: 'upload-1' });
      case 'part':
        if (fail || transientFailure) { transientFailure = false; return new Response('fail', { status: 503 }); }
        sizes.push((options.body as Buffer).length);
        return Response.json({ partNumber: Number(params.get('partNumber')), etag: 'test' });
      case 'complete': return Response.json({ key: params.get('key') });
      case 'abort': aborted = true; return Response.json({ success: true });
      default: throw Error('unexpected action');
    }
  };
  try {
    assert.equal(await uploadMultipartFile(file, 'silva_siufabing', 'https://example.test', 'secret', fetchImpl), 'silva_siufabing_2105577785272225980_1.mp4');
    assert.deepEqual(sizes, [CRAWL_UPLOAD_PART_BYTES, 10]);
    fail = true;
    await assert.rejects(uploadMultipartFile(file, 'silva_siufabing', 'https://example.test', 'secret', fetchImpl), /HTTP 503/);
    assert.equal(aborted, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('oversized files and HTTP 413 never enter the completed media archive', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawl-retry-'));
  const file = path.join(dir, '2105577785272225980_1.webp');
  fs.writeFileSync(file, Buffer.alloc(1));
  const archive = {};
  const options = {
    key: '2105577785272225980', username: 'silva_siufabing', archive, accountNick: '', metaByTweetId: new Map(),
    tasks: [{ outputPath: file, tweetId: '2105577785272225980', mediaId: 'test', item: { type: 'photo' } }],
  };
  const originalFetch = globalThis.fetch;
  try {
    fs.truncateSync(file, MAX_CRAWL_FILE_BYTES + 1);
    assert.equal((await processTweetGroup(options)).failed, 1);
    assert.deepEqual(archive, {});
    fs.truncateSync(file, 1);
    globalThis.fetch = async () => new Response('Payload Too Large', { status: 413 });
    assert.equal((await processTweetGroup(options)).failed, 1);
    assert.deepEqual(archive, {});
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
