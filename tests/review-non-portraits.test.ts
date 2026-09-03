import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  parseVlmResponse,
  optimizeImageBuffer,
  VLM_PORTRAIT_PROMPT,
} from '../scripts/review-non-portraits.mjs';

test('VLM prompt explicitly covers sticker-obscured faces and headless body shots', () => {
  assert.ok(VLM_PORTRAIT_PROMPT.includes('COVERED by an anime avatar sticker'));
  assert.ok(VLM_PORTRAIT_PROMPT.includes('Headless body shots'));
  assert.ok(VLM_PORTRAIT_PROMPT.includes('legs with tights'));
  assert.ok(VLM_PORTRAIT_PROMPT.includes('is_real_person'));
});

test('parseVlmResponse parses standard clean JSON', () => {
  const jsonStr = JSON.stringify({
    is_real_person: true,
    confidence: 0.96,
    reason: '臉部有動漫貼圖，但手部皮膚與背景為真實攝影',
  });

  const parsed = parseVlmResponse(jsonStr);
  assert.equal(parsed.is_real_person, true);
  assert.equal(parsed.confidence, 0.96);
  assert.match(parsed.reason, /臉部有動漫貼圖/);
});

test('parseVlmResponse parses markdown-wrapped JSON code blocks', () => {
  const markdownStr = `Here is my assessment:
\`\`\`json
{
  "is_real_person": false,
  "confidence": 0.99,
  "reason": "二次元動漫插畫，非真實攝影"
}
\`\`\`
Hope this helps!`;

  const parsed = parseVlmResponse(markdownStr);
  assert.equal(parsed.is_real_person, false);
  assert.equal(parsed.confidence, 0.99);
  assert.match(parsed.reason, /二次元動漫插畫/);
});

test('parseVlmResponse gracefully falls back on malformed or empty input', () => {
  const emptyParsed = parseVlmResponse('');
  assert.equal(emptyParsed.is_real_person, true);

  const invalidParsed = parseVlmResponse('Random text with no json');
  assert.equal(invalidParsed.is_real_person, true);
});

test('optimizeImageBuffer resizes oversized image down to max 1024x1024 JPEG', async () => {
  // Create a 2000x1500 test image buffer in memory
  const testBuffer = await sharp({
    create: {
      width: 2000,
      height: 1500,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  }).png().toBuffer();

  const optimized = await optimizeImageBuffer(testBuffer);
  const metadata = await sharp(optimized).metadata();

  assert.equal(metadata.format, 'jpeg');
  assert.ok(metadata.width <= 1024);
  assert.ok(metadata.height <= 1024);
});
