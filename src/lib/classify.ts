import { env } from 'cloudflare:workers';
import { isVideoKey } from './storage';

// Model: llama-3.2-11b-vision-instruct (Cloudflare Workers AI)
// ~9 neurons per image, ~1,100 images/day on the free 10k neuron allocation.
const MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

// The prompt asks for a simple YES/NO so output tokens are minimal.
const CLASSIFY_PROMPT =
  'Look at this image carefully. ' +
  'Is this a portrait, gravure/idol photo, cosplay photo, or fashion photo of a person? ' +
  'Answer with exactly one word: YES or NO. ' +
  'NO for landscapes, game screenshots, memes, food, text-only images, or any non-portrait image.';

/**
 * Classify a single image buffer. Returns true if the image looks like a
 * portrait/cosplay/gravure photo (should be published), false if it should
 * go to pending review.
 *
 * On any AI error, returns true (approve) so that AI downtime does not cause
 * all uploads to be silently deleted after 3 days.
 */
export async function classifyImage(imageBuffer: ArrayBuffer): Promise<boolean> {
  if (!env?.AI) return true; // no AI binding → auto-approve

  try {
    const result: any = await env.AI.run(MODEL, {
      image: [...new Uint8Array(imageBuffer)],
      prompt: CLASSIFY_PROMPT,
      max_tokens: 4,
      temperature: 0.1,
    });

    const text = (result?.response ?? '').trim().toUpperCase();
    // Accept anything starting with "N" as NO, everything else as YES.
    if (text.startsWith('N')) return false;
    return true;
  } catch (err) {
    console.error('AI classification error (auto-approving):', err);
    return true;
  }
}

/**
 * Classify a group of files. Returns true if the post should be published
 * (all images pass), false if any image is non-portrait (pending review).
 *
 * Videos are auto-approved (skip classification). Only images are checked.
 * If there are no images at all (e.g. video-only post), auto-approve.
 */
export async function classifyPost(
  files: { name: string; buffer: ArrayBuffer }[],
): Promise<{ published: boolean; reasons: string[] }> {
  const imageFiles = files.filter((f) => !isVideoKey(f.name));
  if (imageFiles.length === 0) {
    return { published: true, reasons: ['video-only post'] };
  }

  const results = await Promise.all(
    imageFiles.map(async (f) => ({
      name: f.name,
      ok: await classifyImage(f.buffer),
    })),
  );

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    return {
      published: false,
      reasons: failures.map((f) => `${f.name}: non-portrait`),
    };
  }

  return { published: true, reasons: [] };
}
