import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, execSync, spawn } from 'node:child_process';
import sharp from 'sharp';
import { isVideoKey } from '../src/lib/media-classifier.ts';

// ---------------------------------------------------------------------------
// Configuration & Command-line Arguments
// ---------------------------------------------------------------------------

function getArgValue(prefix, fallback) {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (!arg) return fallback;
  const val = arg.split('=')[1];
  if (!val) return fallback;
  return val;
}

const APPLY = process.argv.includes('--apply');
const INCLUDE_REVIEWED = process.argv.includes('--include-reviewed');
const LOCAL_FILE = getArgValue('--file=', '');
const MODEL_NAME = getArgValue('--model=', process.env.VLM_MODEL || 'qwen3.5:4b');
const ENDPOINT = getArgValue('--endpoint=', process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
const SITE_URL = (getArgValue('--site-url=', process.env.SITE_URL || '')).replace(/\/$/, '');
const CRAWL_API_KEY = getArgValue('--api-key=', process.env.CRAWL_API_KEY || '');
const LIMIT_ARG = getArgValue('--limit=', '50');
const MAX_POSTS = LIMIT_ARG.toLowerCase() === 'all' ? 0 : Math.max(1, parseInt(LIMIT_ARG, 10) || 50);
const OFFSET_START = Math.max(0, parseInt(getArgValue('--offset=', '0'), 10) || 0);
const CONCURRENCY = Math.max(1, Math.min(16, parseInt(getArgValue('--concurrency=', '6'), 10) || 6));
const CHECKPOINT_SIZE = Math.max(10, parseInt(getArgValue('--checkpoint=', '500'), 10) || 500);
const USE_WRANGLER = process.argv.includes('--wrangler') || (!SITE_URL && !process.env.SITE_URL);
const D1_DB_NAME = getArgValue('--db=', 'gallery-db');
const R2_BUCKET_NAME = getArgValue('--bucket=', 'gallery-images');
const R2_PUBLIC_URL = (getArgValue('--r2-url=', process.env.R2_PUBLIC_URL || 'https://pub-876dce7204cc44d6910a2b283a13aebe.r2.dev')).replace(/\/$/, '');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const CLI_SHELL = IS_WIN ? 'powershell.exe' : true;

// ---------------------------------------------------------------------------
// VLM Prompt Formulation
// ---------------------------------------------------------------------------

export const VLM_PORTRAIT_PROMPT = `You are an expert visual content auditor. Your mission is to determine if this image originates from REAL-LIFE PHOTOGRAPHY of a person, body, or outfit (is_real_person = true), or if it is purely a 2D ARTWORK / DIGITAL CREATION / NON-HUMAN (is_real_person = false).

🚨 #1 HIGHEST PRIORITY PRINCIPLE — DO NOT JUDGE BY THE FACE:
In social media cosplay, gravure, and selfie culture, REAL HUMAN MODELS routinely paste 2D anime stickers, cartoon avatar drawings, emojis, or mosaics directly over their faces to protect personal privacy or maintain anonymity.
- If you see a 2D anime face or sticker pasted over a person's head, DO NOT classify the image as an anime illustration based on that face!
- Instead, COMPLETELY IGNORE the face and examine the rest of the image:
  1. Skin & Body: Are there real human neck, shoulders, hands, fingers, cleavage, waist, legs with tights/stockings, or feet? Are there real skin pores, skin folds, and anatomical realism?
  2. Clothing & Accessories: Are there real fabric weaves, stitching, natural cloth wrinkles/creases, real leather sheen, or lace texture?
  3. Environment & Lighting: Is there a real room, bed, doorway, wooden floor, mirror reflection, smartphone camera, natural indoor/outdoor lighting, and real-world shadows?
If the body, clothing, and background are real photography, it is 100% TRUE (is_real_person = true), REGARDLESS of what cartoon sticker or anime avatar is pasted on the face.

🚨 #2 CRITICAL PRINCIPLE — ANIME STICKERS, INSET CUTOUTS, PLUSHIES, OR POSTERS IN REAL PHOTOS:
In cosplay and gravure photo sharing:
- Real human models frequently paste 2D anime stickers anywhere on the photo (over face, legs, hips, body, or background as censors, watermarks, or cute decorations).
- Real human models frequently hold anime plushies/dolls, anime figures, acrylic standees, or stand in front of anime posters/wallpapers.
- Cosplayers frequently include a small side-by-side or picture-in-picture reference cutout of the 2D anime character they are portraying.

👉 ABSOLUTE PRINCIPLE: If you can see ANY real physical human body parts (real hands, fingers, legs with tights, skin texture, real cloth wrinkles, real room/floor/furniture), this is 100% A REAL PHOTOGRAPH (is_real_person = true)!
The presence of 2D anime stickers, anime characters, or anime props NEVER makes a real photo non-real!
ONLY mark as is_real_person = false if the ENTIRE image from edge to edge is 100% a hand-drawn illustration or 3D CGI with ZERO real physical human elements.

CRITICAL RULES:
1. MARK AS is_real_person = TRUE:
   - Real photos where the person's face is COVERED by an anime avatar sticker, emoji, mask, smartphone reflection, or mosaic censor.
   - Real photos containing 2D anime character stickers, watermarks, inset character reference cutouts, or plushies.
   - Headless body shots or body part close-ups (e.g. legs with tights/stockings, high heels, hands, outfit check, back view).
   - Real human cosplay, portraits, idol photos, and mirror selfies.

2. MARK AS is_real_person = FALSE ONLY WHEN THE ENTIRE IMAGE IS ARTWORK:
   - Pure 2D anime illustrations, drawings, manga, or webcomics where the WHOLE body, clothing, and background are hand-drawn or digitally painted.
   - 3D CGI or video game screenshots (Genshin, Honkai, Zenless Zone Zero, MMD).
   - Inanimate non-human scenes: food, landscapes, product shots, pure text memes without real people.

CRITICAL INSTRUCTION: Keep the "reason" field ultra-concise and under 15 words.
You MUST reply with a valid JSON object in this exact schema:
{
  "is_real_person": true,
  "confidence": 0.95,
  "reason": "說明理由 (精簡於 15 字以內，描述身體/服裝/環境是否為真實攝影)"
}`;

// ---------------------------------------------------------------------------
// Response Parser
// ---------------------------------------------------------------------------

export function parseVlmResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { is_real_person: true, confidence: 0.5, reason: 'Empty model response (default approve)' };
  }

  // 1. If </think> is present, prioritize parsing content after </think>
  const thinkIdx = rawText.lastIndexOf('</think>');
  const targetText = thinkIdx !== -1 ? rawText.slice(thinkIdx + 8).trim() : rawText.trim();

  let cleaned = targetText;
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  } else {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
  }

  try {
    const parsed = JSON.parse(cleaned);
    const isReal = typeof parsed.is_real_person === 'boolean'
      ? parsed.is_real_person
      : String(parsed.is_real_person).toLowerCase() === 'true';
    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.8;
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';

    return { is_real_person: isReal, confidence, reason };
  } catch (err) {
    // 2. Try regex extraction of formulated output (inspect last 1500 chars to target the final conclusion)
    const tail = rawText.slice(-1500);
    const isRealMatch = tail.match(/is_real_person[^\w]*(?:(?:must|should|is)\s*(?:be\s*)?)?(true|false)/i);
    if (isRealMatch) {
      const isReal = isRealMatch[1].toLowerCase() === 'true';
      const confidenceMatch = tail.match(/confidence[^\w]*([0-9.]+)/i);
      const reasonMatch = tail.match(/reason[^\w]*([^\n]+)/i);
      const conf = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.95;
      const cleanReason = (reasonMatch && reasonMatch[1].trim())
        ? reasonMatch[1].replace(/^[:\s"'`]+|["'`]+$/g, '').trim()
        : (isReal ? 'Real person photograph with authentic physical body and clothing.' : '2D anime drawing, illustration, or CGI render.');
      return { is_real_person: isReal, confidence: conf, reason: cleanReason };
    }

    const lower = rawText.toLowerCase();

    // Check for clear, unambiguous non-real conclusion indicators
    const isNotReal = lower.includes('not a photograph of a real person')
      || lower.includes('not a real person')
      || lower.includes('is not a photograph')
      || lower.includes('pure 2d anime illustration')
      || lower.includes('purely a 2d illustration')
      || lower.includes('entire image is a 2d')
      || lower.includes('entirely a 2d drawing')
      || lower.includes('is_real_person: false')
      || lower.includes('is_real_person = false')
      || lower.includes('"is_real_person": false')
      || lower.includes('is_real_person must be false')
      || lower.includes('is_real_person should be false');

    // Check for real person indicators
    const isReal = lower.includes('photograph of a real person')
      || lower.includes('photographic evidence of a')
      || lower.includes('photograph of a person in cosplay')
      || lower.includes('clearly a photograph of a person')
      || lower.includes('is undeniably real')
      || lower.includes('clearly a real human')
      || lower.includes('is_real_person: true')
      || lower.includes('is_real_person = true')
      || lower.includes('"is_real_person": true')
      || lower.includes('is_real_person must be true')
      || lower.includes('is_real_person should be true');

    if (isNotReal && !isReal) {
      const reasonMatch = rawText.match(/(?:This is clearly|The art style is|The image is a) ([^\n.]+)/i);
      const reason = reasonMatch ? reasonMatch[0].trim() : 'Digital illustration or 2D anime artwork.';
      return { is_real_person: false, confidence: 0.98, reason };
    }

    if (isReal && !isNotReal) {
      const reasonMatch = rawText.match(/(?:The image is clearly|The image clearly depicts|The body, hands, clothing) ([^\n.]+)/i);
      const reason = reasonMatch ? reasonMatch[0].trim() : 'Real person photograph with authentic physical body and clothing.';
      return { is_real_person: true, confidence: 0.98, reason };
    }

    // Default to true (Safe-keep real person photos)
    return { is_real_person: true, confidence: 0.7, reason: 'Real photograph or cosplay photo in physical environment.' };
  }
}

// ---------------------------------------------------------------------------
// Ollama Auto-Start & Readiness
// ---------------------------------------------------------------------------

export async function resolveEndpoint(preferredEndpoint = ENDPOINT) {
  const candidates = [
    preferredEndpoint,
    'http://localhost:8000/v1',
    'http://127.0.0.1:8000/v1',
    process.env.OLLAMA_HOST,
    'http://localhost:11434',
    'http://localhost:11500',
    'http://127.0.0.1:11434',
    'http://127.0.0.1:11500',
  ].filter(Boolean).map((e) => (e.startsWith('http') ? e : `http://${e}`)).map((e) => e.replace(/\/$/, ''));

  for (const url of [...new Set(candidates)]) {
    try {
      if (url.includes(':8000')) {
        const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const loadedModel = data.data?.[0]?.id;
          return { endpoint: url, model: loadedModel || MODEL_NAME, isVllm: true };
        }
      }
      const res = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return { endpoint: url, model: MODEL_NAME, isVllm: false };
    } catch {}
  }
  return { endpoint: preferredEndpoint, model: MODEL_NAME, isVllm: preferredEndpoint.includes(':8000') };
}

export async function ensureOllamaRunning(endpoint = ENDPOINT) {
  if (!endpoint.includes('localhost') && !endpoint.includes('127.0.0.1')) {
    return;
  }

  try {
    const res = await fetch(`${endpoint}/api/version`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) return;
  } catch {}

  console.log('🤖 Starting local Ollama service in the background...');
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    'ollama',
    ...(IS_WIN ? [path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe')] : []),
    ...(IS_MAC ? [
      '/opt/homebrew/bin/ollama',
      '/usr/local/bin/ollama',
      '/Applications/Ollama.app/Contents/Resources/ollama',
    ] : []),
  ];

  for (const bin of candidates) {
    try {
      const child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      break;
    } catch {}
  }

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(`${endpoint}/api/version`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        console.log('✅ Local Ollama service is online.');
        return;
      }
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// VLM Image Classifier Client
// ---------------------------------------------------------------------------

export async function optimizeImageBuffer(rawBuffer) {
  return await sharp(rawBuffer)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

export async function classifyImageWithVlm({
  buffer,
  endpoint = ENDPOINT,
  model = MODEL_NAME,
  timeoutMs = 60_000,
}) {
  const optimizedBuffer = await optimizeImageBuffer(buffer);
  const base64 = optimizedBuffer.toString('base64');
  const normalizedEndpoint = endpoint.replace(/\/$/, '');

  // Try Ollama native /api/chat first
  if (!normalizedEndpoint.includes('/v1')) {
    try {
      const response = await fetch(`${normalizedEndpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: VLM_PORTRAIT_PROMPT,
              images: [base64],
            },
          ],
          stream: false,
          format: 'json',
          options: {
            temperature: 0.1,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.message?.content;
        const thinking = data.message?.thinking;
        const raw = (content && content.trim() !== '{}' && content.trim().length > 2)
          ? content
          : (thinking || content || '');
        return parseVlmResponse(raw);
      }
    } catch {
      // Fall through to OpenAI-compatible endpoint
    }
  }

  // Fallback to OpenAI-compatible /v1/chat/completions
  const v1Url = normalizedEndpoint.endsWith('/v1')
    ? `${normalizedEndpoint}/chat/completions`
    : `${normalizedEndpoint}/v1/chat/completions`;

  try {
    const response = await fetch(v1Url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an image classifier. Evaluate if the image depicts a real person or 2D artwork. Output ONLY a valid JSON object: {"is_real_person": boolean, "confidence": number, "reason": "concise explanation"}. Do NOT output chain of thought or markdown.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: VLM_PORTRAIT_PROMPT },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64}` },
              },
            ],
          },
        ],
        chat_template_kwargs: {
          enable_thinking: false,
        },
        temperature: 0.0,
        max_tokens: 250,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`VLM request failed: HTTP ${response.status} - ${text}`);
    }

    const data = await response.json();
    const msg = data.choices?.[0]?.message;
    const rawContent = (msg?.content && msg.content.trim() !== '{}' && msg.content.trim().length > 2)
      ? msg.content
      : (msg?.thinking || msg?.content || '');
    return parseVlmResponse(rawContent);
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
      throw new Error(`Could not connect to VLM service at ${endpoint}. Make sure Ollama or your VLM server is running (e.g., run 'ollama run ${model}' or 'ollama serve').`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Wrangler Direct Integration (D1 + R2)
// ---------------------------------------------------------------------------

export function execSyncWithRetry(cmd, options = {}, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return execSync(cmd, options);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const waitMs = attempt * 3000;
        console.warn(`  ⚠️ D1 command transient error (attempt ${attempt}/${maxRetries}), retrying in ${waitMs / 1000}s...`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
      }
    }
  }
  throw lastError;
}

export function fetchPublishedBatchWrangler({
  offset = 0,
  limit = 48,
  dbName = D1_DB_NAME,
  includeReviewed = INCLUDE_REVIEWED,
  cursorId = null,
}) {
  const reviewedClause = includeReviewed ? '' : 'AND reviewed = 0';
  const cursorClause = cursorId ? `AND id < ${cursorId}` : '';
  const offsetClause = cursorId ? '' : (offset > 0 ? `OFFSET ${offset}` : '');
  const sql = `SELECT id, r2_keys, author, title FROM images WHERE published = 1 ${reviewedClause} ${cursorClause} ORDER BY id DESC LIMIT ${limit} ${offsetClause};`;
  const cmd = `npx wrangler d1 execute ${dbName} --remote --command="${sql}" --json`;
  const stdout = execSyncWithRetry(cmd, {
    encoding: 'utf-8',
    shell: CLI_SHELL,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(stdout);
  const items = parsed[0]?.results || [];
  return { items, hasMore: items.length === limit };
}

export function fetchR2ImageBufferWrangler({ r2Key, bucketName = R2_BUCKET_NAME }) {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `vlm_r2_${Date.now()}_${Math.random().toString(36).slice(2)}_${path.basename(r2Key)}`);
  try {
    const cmd = `npx wrangler r2 object get "${bucketName}/${r2Key}" --file "${tmpFile}" --remote`;
    execSyncWithRetry(cmd, {
      encoding: 'utf-8',
      shell: CLI_SHELL,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return fs.readFileSync(tmpFile);
  } finally {
    if (fs.existsSync(tmpFile)) {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }
}

export function applyPendingPostsWrangler({ pendingIds = [], dbName = D1_DB_NAME }) {
  if (pendingIds.length === 0) return { updated_count: 0 };
  const chunkSize = 100;
  for (let i = 0; i < pendingIds.length; i += chunkSize) {
    const chunk = pendingIds.slice(i, i + chunkSize);
    const idsStr = chunk.join(',');
    const sql = `UPDATE images SET published = 0, reviewed = 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (${idsStr}); UPDATE storage_stats SET directory_version = directory_version + 1;`;
    const cmd = `npx wrangler d1 execute ${dbName} --remote --command="${sql}" --json`;
    execSyncWithRetry(cmd, {
      encoding: 'utf-8',
      shell: CLI_SHELL,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  return { updated_count: pendingIds.length };
}

export function applyApprovedPostsWrangler({ approvedIds = [], dbName = D1_DB_NAME }) {
  if (approvedIds.length === 0) return { updated_count: 0 };
  const chunkSize = 100;
  for (let i = 0; i < approvedIds.length; i += chunkSize) {
    const chunk = approvedIds.slice(i, i + chunkSize);
    const idsStr = chunk.join(',');
    const sql = `UPDATE images SET reviewed = 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (${idsStr});`;
    const cmd = `npx wrangler d1 execute ${dbName} --remote --command="${sql}" --json`;
    execSyncWithRetry(cmd, {
      encoding: 'utf-8',
      shell: CLI_SHELL,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  return { updated_count: approvedIds.length };
}

// ---------------------------------------------------------------------------
// HTTP & Gallery API Helpers
// ---------------------------------------------------------------------------

export async function fetchPublishedBatchHttp({ siteUrl = SITE_URL, offset = 0, limit = 48 }) {
  const url = `${siteUrl}/api/images?limit=${limit}&offset=${offset}&sort=newest`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`Fetch gallery images failed: HTTP ${response.status} - ${await response.text()}`);
  }
  const items = await response.json();
  const hasMore = response.headers.get('X-Has-More') === 'true';
  return { items, hasMore };
}

export async function fetchR2ImageBufferHttp({ siteUrl = SITE_URL || R2_PUBLIC_URL, r2Key, retries = 2 }) {
  const cleanBase = siteUrl.replace(/\/$/, '');
  const url = cleanBase.includes('r2.dev')
    ? `${cleanBase}/${encodeURIComponent(r2Key)}`
    : `${cleanBase}/api/r2/${encodeURIComponent(r2Key)}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for image "${r2Key}"`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      } else {
        throw err;
      }
    }
  }
}

export async function applyPendingPostsHttp({ siteUrl = SITE_URL, apiKey = CRAWL_API_KEY, pendingIds = [] }) {
  if (pendingIds.length === 0) return { updated_count: 0 };
  const url = `${siteUrl}/api/phash-scan?action=apply_pending`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({ pending_ids: pendingIds }),
  });
  if (!response.ok) {
    throw new Error(`Apply pending posts failed: HTTP ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}

// ---------------------------------------------------------------------------
// Main Execution Workflow
// ---------------------------------------------------------------------------

async function mapConcurrent(items, limit, fn) {
  const results = [];
  const executing = new Set();
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

export async function main() {
  console.log('======================================================================');
  console.log('🖼️  X-gallery VLM Batch Photo & Portrait Classifier');
  // Auto-discover active vLLM or Ollama endpoint
  const resolved = await resolveEndpoint(ENDPOINT);
  const activeEndpoint = typeof resolved === 'object' ? resolved.endpoint : resolved;
  const activeModel = (typeof resolved === 'object' && resolved.model) ? resolved.model : MODEL_NAME;
  const isVllm = typeof resolved === 'object' ? resolved.isVllm : false;
  const effectiveConcurrency = isVllm ? Math.max(CONCURRENCY, 6) : CONCURRENCY;

  console.log(`VLM Engine   : ${isVllm ? '⚡ vLLM (Continuous Batching + AWQ)' : '🦙 Ollama'}`);
  console.log(`VLM Endpoint : ${activeEndpoint}`);
  console.log(`Model        : ${activeModel}`);
  console.log(`Data Source  : ☁️ Cloudflare Wrangler (D1: ${D1_DB_NAME})`);
  console.log(`Image Source : ⚡ Fast HTTP (${R2_PUBLIC_URL || SITE_URL})`);
  console.log(`Concurrency  : ${effectiveConcurrency}`);
  console.log(`Mode         : ${APPLY ? '⚡ APPLY (Will move non-portraits to pending review)' : '🔍 DRY-RUN (Audit only, safe mode)'}`);
  console.log('----------------------------------------------------------------------');

  if (!isVllm) {
    // Auto-start Ollama if local and not running
    await ensureOllamaRunning(activeEndpoint);
  }

  // Single File Direct Mode
  if (LOCAL_FILE) {
    if (!fs.existsSync(LOCAL_FILE)) {
      console.error(`File not found: ${LOCAL_FILE}`);
      process.exit(1);
    }
    console.log(`Classifying local file: ${LOCAL_FILE}...`);
    const fileBuffer = fs.readFileSync(LOCAL_FILE);
    const result = await classifyImageWithVlm({ buffer: fileBuffer });
    console.log('\n--- Result ---');
    console.log(`Is Real Person Portrait : ${result.is_real_person ? '✅ YES' : '❌ NO'}`);
    console.log(`Confidence Score        : ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`Reason                  : ${result.reason}`);
    return;
  }

  // Gallery Batch Mode
  let currentOffset = OFFSET_START;
  let cursorId = null;
  let totalProcessed = 0;
  let checkpointNum = 1;
  const flaggedPosts = [];
  const passedPosts = [];
  let uncommittedFlagged = [];
  let uncommittedPassed = [];

  const commitCheckpoint = async (isFinal = false) => {
    if (!APPLY) return;
    const toFlag = uncommittedFlagged;
    const toPass = uncommittedPassed;
    if (toFlag.length === 0 && toPass.length === 0) return;

    console.log(`\n======================================================================`);
    console.log(`💾 Checkpoint #${checkpointNum++} ${isFinal ? '(Final Batch)' : `(Every ${CHECKPOINT_SIZE} items)`} — Saving to D1...`);

    try {
      if (toFlag.length > 0) {
        const idsToPending = toFlag.map((f) => f.post.id);
        let updateCount = idsToPending.length;
        if (USE_WRANGLER) {
          const updateResult = applyPendingPostsWrangler({ pendingIds: idsToPending });
          updateCount = updateResult.updated_count;
        } else {
          if (!CRAWL_API_KEY) {
            console.error('Error: CRAWL_API_KEY is required to apply changes via HTTP API.');
            process.exit(1);
          }
          const updateResult = await applyPendingPostsHttp({ siteUrl: SITE_URL, apiKey: CRAWL_API_KEY, pendingIds: idsToPending });
          updateCount = updateResult.updated_count ?? idsToPending.length;
        }
        console.log(`  ✓ Successfully updated ${updateCount} post(s) to Review (published = 0, reviewed = 1).`);
      }

      if (toPass.length > 0) {
        const passedIds = toPass.map((p) => p.id);
        if (USE_WRANGLER) {
          applyApprovedPostsWrangler({ approvedIds: passedIds });
        }
        console.log(`  ✓ Successfully marked ${passedIds.length} real portrait post(s) as reviewed in D1 (reviewed = 1).`);
      }

      console.log(`✅ Checkpoint saved! Cumulative evaluated so far: ${totalProcessed} posts.`);
      console.log(`======================================================================\n`);

      uncommittedFlagged = [];
      uncommittedPassed = [];
    } catch (err) {
      console.warn(`  ⚠️ Checkpoint save encountered transient error: ${err.message}. Retaining items in buffer for next cycle...`);
    }
  };

  console.log(`Fetching published posts from gallery (batch mode: ${USE_WRANGLER ? '⚡ D1 Index Cursor Seek' : 'HTTP Offset'}, checkpoint: every ${CHECKPOINT_SIZE} posts)...`);

  while (true) {
    const batchLimit = MAX_POSTS > 0 ? Math.min(48, MAX_POSTS - totalProcessed) : 48;
    if (batchLimit <= 0) break;

    let batchResult;
    try {
      if (USE_WRANGLER) {
        batchResult = fetchPublishedBatchWrangler({ limit: batchLimit, cursorId, offset: currentOffset });
      } else {
        batchResult = await fetchPublishedBatchHttp({ siteUrl: SITE_URL, offset: currentOffset, limit: batchLimit });
      }
    } catch (err) {
      console.error(`Failed to fetch batch at cursor ${cursorId || currentOffset}: ${err.message}`);
      break;
    }

    const { items, hasMore } = batchResult;
    if (!items || items.length === 0) break;

    // Track minimum ID in this batch to advance the cursor for next query
    const minId = Math.min(...items.map((it) => it.id));
    cursorId = minId;

    console.log(`\nProcessing page of ${items.length} post(s) (concurrency: ${effectiveConcurrency})...`);

    await mapConcurrent(items, effectiveConcurrency, async (post) => {
      const keys = (post.r2_keys || '').split(',').map((k) => k.trim()).filter(Boolean);
      const photoKeys = keys.filter((k) => !isVideoKey(k));

      // Auto-keep video-only posts without re-evaluating
      if (photoKeys.length === 0) {
        passedPosts.push(post);
        uncommittedPassed.push(post);
        totalProcessed++;
        return;
      }

      const primaryKey = photoKeys[0];
      try {
        let imageBuffer;
        if (SITE_URL || R2_PUBLIC_URL) {
          try {
            imageBuffer = await fetchR2ImageBufferHttp({ siteUrl: SITE_URL || R2_PUBLIC_URL, r2Key: primaryKey });
          } catch {
            imageBuffer = fetchR2ImageBufferWrangler({ r2Key: primaryKey });
          }
        } else {
          imageBuffer = fetchR2ImageBufferWrangler({ r2Key: primaryKey });
        }

        let classification;
        try {
          classification = await classifyImageWithVlm({ buffer: imageBuffer, endpoint: activeEndpoint, model: activeModel });
        } catch (vlmErr) {
          if (vlmErr.message?.includes('Could not connect to VLM') || vlmErr.cause?.code === 'ECONNREFUSED' || vlmErr.message?.includes('fetch failed')) {
            console.warn(`  ⏳ VLM server disconnected, waiting 5s before retry...`);
            await new Promise((r) => setTimeout(r, 5000));
            classification = await classifyImageWithVlm({ buffer: imageBuffer, endpoint: activeEndpoint, model: activeModel });
          } else {
            throw vlmErr;
          }
        }

        totalProcessed++;
        const pct = (classification.confidence * 100).toFixed(0);

        if (classification.is_real_person) {
          passedPosts.push(post);
          uncommittedPassed.push(post);
          console.log(`  ✓ [ID: ${post.id}] @${post.author}: REAL PERSON (${pct}%) - "${classification.reason}"`);
        } else {
          const entry = { post, classification };
          flaggedPosts.push(entry);
          uncommittedFlagged.push(entry);
          console.log(`  ✗ [ID: ${post.id}] @${post.author}: NON-REAL (${pct}%) - "${classification.reason}"`);
        }
      } catch (err) {
        console.warn(`  ⚠️ [ID: ${post.id}] @${post.author} skipped due to error: ${err.message}`);
      }
    });

    // Checkpoint commit to D1 if threshold reached
    if (uncommittedFlagged.length + uncommittedPassed.length >= CHECKPOINT_SIZE) {
      await commitCheckpoint(false);
    }

    currentOffset += items.length;
    if (!hasMore || (MAX_POSTS > 0 && totalProcessed >= MAX_POSTS)) {
      break;
    }
  }

  // Commit any remaining uncommitted results
  if (APPLY) {
    await commitCheckpoint(true);
  }

  console.log('\n======================================================================');
  console.log('📊 Scan Summary');
  console.log('======================================================================');
  console.log(`Total Posts Evaluated : ${totalProcessed}`);
  console.log(`Real Person (Kept)    : ${passedPosts.length}`);
  console.log(`Non-Real (Flagged)    : ${flaggedPosts.length}`);

  if (flaggedPosts.length > 0) {
    console.log('\nFlagged Post IDs:');
    console.log(flaggedPosts.map((f) => f.post.id).join(', '));
  }
  if (!APPLY && (flaggedPosts.length > 0 || passedPosts.length > 0)) {
    console.log('\n💡 Notice: Running in DRY-RUN mode. No database records were modified.');
    console.log('To move flagged posts to Review and mark evaluated posts as reviewed, re-run with --apply:');
    console.log(`node scripts/review-non-portraits.mjs --apply --limit=${LIMIT_ARG}`);
  }
}

// Self-run when executed directly via node
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  main().catch((err) => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
}
