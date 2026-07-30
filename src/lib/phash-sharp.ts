import sharp from 'sharp';
import { compute2DDCT } from './phash-utils.ts';

/**
  * Calculate 64-bit pHash hex string (16 chars) for an image buffer using Sharp.
  * Handles transparent PNGs, RGBA, and sRGB correctly by flattening and converting to 1-channel b-w.
  */
export async function computePHash(imageBuffer: Buffer | ArrayBuffer): Promise<string> {
  const buffer = imageBuffer instanceof Buffer ? imageBuffer : Buffer.from(imageBuffer);

  const { data, info } = await sharp(buffer)
    .flatten({ background: '#ffffff' })
    .resize(32, 32, { fit: 'fill' })
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 1 || data.length !== 32 * 32) {
    throw new Error(`Unexpected raw image format: ${info.channels} channels, length ${data.length} (expected 1 channel, 1024 bytes)`);
  }

  const dct = compute2DDCT(data, 32);

  // Extract top-left 8x8 coefficients (64 coefficients)
  const vals: number[] = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      vals.push(dct[u * 32 + v]);
    }
  }

  const sorted = [...vals].sort((a, b) => a - b);
  const median = (sorted[31] + sorted[32]) / 2;

  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    if (vals[i] > median) {
      hash |= (1n << BigInt(i));
    }
  }

  return hash.toString(16).padStart(16, '0');
}
