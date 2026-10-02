import { MAX_CRAWL_FILE_BYTES, CRAWL_UPLOAD_PART_BYTES } from './crawl-upload-limits.mjs';

export async function handleCrawlMultipart(
  request: Request,
  bucket: R2Bucket,
  exceedsStorage: (bytes: number) => Promise<boolean>,
  addBytes: (bytes: number) => Promise<void>,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const action = params.get('action');
  const size = Number(params.get('size'));
  const key = params.get('key') ?? '';
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_CRAWL_FILE_BYTES) {
    return Response.json({ error: 'File must be between 1 byte and 1 GB' }, { status: 413 });
  }
  if (!/^[a-zA-Z0-9_]{1,15}_\d+_\d+(?:\.transcoded)?\.(?:mp4|webm|mov|m4v|webp|jpg|jpeg|png)$/.test(key)) {
    return Response.json({ error: 'Invalid crawler file key' }, { status: 400 });
  }
  if (action === 'create' && request.method === 'POST') {
    if (await exceedsStorage(size)) return Response.json({ error: 'Storage capacity exceeded' }, { status: 507 });
    const previous = await bucket.head(key);
    if (previous) {
      if (previous.size !== size) return Response.json({ error: 'Existing file size differs' }, { status: 409 });
      return Response.json({ key, exists: true });
    }
    const upload = await bucket.createMultipartUpload(key, {
      httpMetadata: { contentType: /\.(?:mp4|webm|mov|m4v)$/.test(key) ? 'video/mp4' : 'image/webp' },
      customMetadata: { crawlSize: String(size) },
    });
    return Response.json({ key, uploadId: upload.uploadId });
  }
  const uploadId = params.get('uploadId');
  if (!uploadId) return Response.json({ error: 'Missing uploadId' }, { status: 400 });
  const upload = bucket.resumeMultipartUpload(key, uploadId);
  if (action === 'abort' && request.method === 'POST') {
    await upload.abort();
    return Response.json({ success: true });
  }
  const partCount = Math.ceil(size / CRAWL_UPLOAD_PART_BYTES);
  if (action === 'part' && request.method === 'PUT') {
    const partNumber = Number(params.get('partNumber'));
    const expectedSize = partNumber === partCount ? size - (partCount - 1) * CRAWL_UPLOAD_PART_BYTES : CRAWL_UPLOAD_PART_BYTES;
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount ||
        Number(request.headers.get('Content-Length')) !== expectedSize || !request.body) {
      return Response.json({ error: 'Invalid upload part or length' }, { status: 400 });
    }
    return Response.json(await upload.uploadPart(partNumber, request.body));
  }
  if (action === 'complete' && request.method === 'POST') {
    const { parts } = await request.json() as { parts: R2UploadedPart[] };
    if (!Array.isArray(parts) || parts.length !== partCount || parts.some((part, i) =>
      !part || part.partNumber !== i + 1 || typeof part.etag !== 'string' || !part.etag)) {
      return Response.json({ error: 'Invalid upload parts' }, { status: 400 });
    }
    // A lost response after completion must not count the same object twice.
    const previous = await bucket.head(key);
    if (previous?.size === size && previous.customMetadata?.crawlSize === String(size)) {
      return Response.json({ key });
    }
    if (await exceedsStorage(size)) return Response.json({ error: 'Storage capacity exceeded' }, { status: 507 });
    const object = await upload.complete(parts);
    if (object.size !== size) {
      await bucket.delete(key);
      return Response.json({ error: 'Completed upload size mismatch' }, { status: 400 });
    }
    await addBytes(object.size);
    return Response.json({ key });
  }
  return Response.json({ error: 'Invalid multipart action' }, { status: 400 });
}
