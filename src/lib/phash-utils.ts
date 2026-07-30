export interface ImageHashItem {
  imageId: number;
  r2Key: string;
  phash: string;
  likes: number;
  postUrl?: string | null;
  title?: string | null;
  createdAt?: string | null;
}

export interface ClusterMatch {
  preferredPostId: number;
  preferredTitle?: string | null;
  candidatePostId: number;
  candidateTitle?: string | null;
  distance: number;
  similarity: string;
}

export interface ClusterResult {
  keeperIds: number[];
  pendingIds: number[];
  matches: ClusterMatch[];
  totalMatchPairsCount: number;
}

/**
  * Validate if string is a valid 16-character hexadecimal pHash.
  */
export function isValidPHashHex(hex: unknown): hex is string {
  return typeof hex === 'string' && /^[0-9a-fA-F]{16}$/.test(hex);
}

// Precomputed Cosine matrix lookup table for N = 32 to eliminate dynamic Math.cos() calls
const DCT_N = 32;
const COS_LOOKUP = new Float64Array(DCT_N * DCT_N);
const C_FACTOR = new Float64Array(DCT_N);

C_FACTOR[0] = 1 / Math.sqrt(2);
for (let i = 1; i < DCT_N; i++) C_FACTOR[i] = 1.0;

for (let u = 0; u < DCT_N; u++) {
  for (let x = 0; x < DCT_N; x++) {
    COS_LOOKUP[u * DCT_N + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * DCT_N));
  }
}

/**
  * Fast Separable 2D Discrete Cosine Transform (DCT) on 32 x 32 1-channel matrix.
  * Uses 1D row-column separable decomposition and precomputed cosine lookup tables,
  * reducing computational complexity from 1,048,576 operations to 65,536 (16x-100x speedup).
  */
export function compute2DDCT(pixels: Uint8Array | Float64Array | number[], N = 32): Float64Array {
  if (N !== 32) {
    // Fallback for non-32 size
    const dct = new Float64Array(N * N);
    const c = new Float64Array(N);
    c[0] = 1 / Math.sqrt(2);
    for (let i = 1; i < N; i++) c[i] = 1;
    for (let u = 0; u < N; u++) {
      for (let v = 0; v < N; v++) {
        let sum = 0;
        for (let x = 0; x < N; x++) {
          for (let y = 0; y < N; y++) {
            sum += pixels[x * N + y]
              * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))
              * Math.cos(((2 * y + 1) * v * Math.PI) / (2 * N));
          }
        }
        dct[u * N + v] = 0.25 * c[u] * c[v] * sum;
      }
    }
    return dct;
  }

  // Separable 2D DCT for 32x32:
  // Step 1: Compute 1D DCT along rows: intermediate[x, v] = sum_y pixels[x, y] * cos(v, y)
  const intermediate = new Float64Array(32 * 32);
  for (let x = 0; x < 32; x++) {
    const rowOffset = x * 32;
    for (let v = 0; v < 32; v++) {
      const vOffset = v * 32;
      let sum = 0;
      for (let y = 0; y < 32; y++) {
        sum += pixels[rowOffset + y] * COS_LOOKUP[vOffset + y];
      }
      intermediate[rowOffset + v] = sum;
    }
  }

  // Step 2: Compute 1D DCT along columns: dct[u, v] = 0.25 * c(u) * c(v) * sum_x intermediate[x, v] * cos(u, x)
  const dct = new Float64Array(32 * 32);
  for (let u = 0; u < 32; u++) {
    const uOffset = u * 32;
    const cu = C_FACTOR[u];
    for (let v = 0; v < 32; v++) {
      const cv = C_FACTOR[v];
      const factor = 0.25 * cu * cv;
      let sum = 0;
      for (let x = 0; x < 32; x++) {
        sum += intermediate[x * 32 + v] * COS_LOOKUP[uOffset + x];
      }
      dct[uOffset + v] = factor * sum;
    }
  }

  return dct;
}

/**
  * Compute Hamming Distance between two 64-bit pHash hex strings.
  */
export function hammingDistance(hexA: string, hexB: string): number {
  if (!isValidPHashHex(hexA) || !isValidPHashHex(hexB)) {
    throw new Error(`Invalid hex pHash: "${hexA}" vs "${hexB}" (must be 16-char hex strings)`);
  }

  const a = BigInt(`0x${hexA}`);
  const b = BigInt(`0x${hexB}`);
  let diff = a ^ b;
  let count = 0n;
  while (diff > 0n) {
    diff &= diff - 1n;
    count++;
  }
  return Number(count);
}

/**
  * Disjoint Set Union (Union-Find) for grouping items into connected component clusters.
  */
export class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Array(size).fill(0);
  }

  find(i: number): number {
    if (this.parent[i] === i) return i;
    this.parent[i] = this.find(this.parent[i]);
    return this.parent[i];
  }

  union(i: number, j: number): void {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI !== rootJ) {
      if (this.rank[rootI] < this.rank[rootJ]) {
        this.parent[rootI] = rootJ;
      } else if (this.rank[rootI] > this.rank[rootJ]) {
        this.parent[rootJ] = rootI;
      } else {
        this.parent[rootJ] = rootI;
        this.rank[rootI]++;
      }
    }
  }
}

const MAX_SAMPLE_MATCHES = 100;

/**
  * Build connected duplicate clusters from image pHashes and pick canonical winners.
  * Bounded memory protection: caps sample matches array size to max 100 items.
  */
export function buildDuplicateClusters(
  items: ImageHashItem[],
  threshold: number,
): ClusterResult {
  if (items.length === 0) {
    return { keeperIds: [], pendingIds: [], matches: [], totalMatchPairsCount: 0 };
  }

  // Pre-parse hex pHashes into BigInts to optimize O(N^2) bitwise comparisons
  const parsedItems = items.map((item) => {
    if (!isValidPHashHex(item.phash)) {
      throw new Error(`Invalid pHash format for image #${item.imageId}: "${item.phash}"`);
    }
    return {
      ...item,
      hashBigInt: BigInt(`0x${item.phash}`),
    };
  });

  const uf = new UnionFind(parsedItems.length);
  const matches: ClusterMatch[] = [];
  let totalMatchPairsCount = 0;

  for (let i = 0; i < parsedItems.length; i++) {
    for (let j = i + 1; j < parsedItems.length; j++) {
      const a = parsedItems[i];
      const b = parsedItems[j];

      if (a.imageId === b.imageId) continue; // Skip images within the same post

      let diff = a.hashBigInt ^ b.hashBigInt;
      let dist = 0;
      while (diff > 0n) {
        diff &= diff - 1n;
        dist++;
      }

      if (dist <= threshold) {
        uf.union(i, j);
        totalMatchPairsCount++;

        if (matches.length < MAX_SAMPLE_MATCHES) {
          let pref = a;
          let cand = b;
          if (b.likes > a.likes || (b.likes === a.likes && b.imageId < a.imageId)) {
            pref = b;
            cand = a;
          }

          matches.push({
            preferredPostId: pref.imageId,
            preferredTitle: pref.title,
            candidatePostId: cand.imageId,
            candidateTitle: cand.title,
            distance: dist,
            similarity: `${(((64 - dist) / 64) * 100).toFixed(1)}%`,
          });
        }
      }
    }
  }

  // Group items by cluster root
  const clustersMap = new Map<number, typeof parsedItems>();
  for (let i = 0; i < parsedItems.length; i++) {
    const root = uf.find(i);
    const group = clustersMap.get(root) ?? [];
    group.push(parsedItems[i]);
    clustersMap.set(root, group);
  }

  const keeperIdsSet = new Set<number>();
  const pendingIdsSet = new Set<number>();

  for (const group of clustersMap.values()) {
    const uniquePostsMap = new Map<number, (typeof parsedItems)[0]>();
    for (const item of group) {
      if (!uniquePostsMap.has(item.imageId)) {
        uniquePostsMap.set(item.imageId, item);
      }
    }
    const posts = [...uniquePostsMap.values()];

    if (posts.length === 1) {
      keeperIdsSet.add(posts[0].imageId);
      continue;
    }

    // Sort posts to find canonical winner for the cluster:
    // Highest likes, then smallest imageId (earliest post)
    posts.sort((x, y) => {
      if (y.likes !== x.likes) return y.likes - x.likes;
      return x.imageId - y.imageId;
    });

    const keeper = posts[0];
    keeperIdsSet.add(keeper.imageId);

    for (let k = 1; k < posts.length; k++) {
      pendingIdsSet.add(posts[k].imageId);
    }
  }

  // Correctness Rule: If a post lost in ANY cluster, it MUST go to pending review!
  for (const pId of pendingIdsSet) {
    keeperIdsSet.delete(pId);
  }

  return {
    keeperIds: [...keeperIdsSet],
    pendingIds: [...pendingIdsSet],
    matches,
    totalMatchPairsCount,
  };
}

/**
  * Helper to chunk array into batches to prevent D1 bound parameter limits (max 100).
  */
export function chunkArray<T>(array: T[], size = 80): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
