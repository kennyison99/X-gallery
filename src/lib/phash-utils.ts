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
  keeperPostId: number;
  keeperTitle?: string | null;
  flagPostId: number;
  flagTitle?: string | null;
  distance: number;
  similarity: string;
}

export interface ClusterResult {
  keeperIds: number[];
  pendingIds: number[];
  matches: ClusterMatch[];
}

/**
  * Validate if string is a valid 16-character hexadecimal pHash.
  */
export function isValidPHashHex(hex: unknown): hex is string {
  return typeof hex === 'string' && /^[0-9a-fA-F]{16}$/.test(hex);
}

/**
  * Compute 2D Discrete Cosine Transform (DCT) on N x N 1-channel grayscale matrix.
  */
export function compute2DDCT(pixels: Uint8Array | Float64Array | number[], N = 32): Float64Array {
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

/**
  * Build connected duplicate clusters from image pHashes and pick canonical winners.
  * Correctness Rule: A post that loses in ANY cluster comparison is marked as pending.
  * Winner status in one cluster cannot override a loser status in another cluster.
  */
export function buildDuplicateClusters(
  items: ImageHashItem[],
  threshold: number,
): ClusterResult {
  if (items.length === 0) {
    return { keeperIds: [], pendingIds: [], matches: [] };
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

        let keep = a;
        let flag = b;
        if (b.likes > a.likes || (b.likes === a.likes && b.imageId < a.imageId)) {
          keep = b;
          flag = a;
        }

        matches.push({
          keeperPostId: keep.imageId,
          keeperTitle: keep.title,
          flagPostId: flag.imageId,
          flagTitle: flag.title,
          distance: dist,
          similarity: `${(((64 - dist) / 64) * 100).toFixed(1)}%`,
        });
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
    // Unique posts in this cluster
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

  // Correctness Rule (Blocker 2):
  // If a post lost in ANY cluster (present in pendingIdsSet), it MUST go to pending review!
  // It can NEVER remain a keeper just because it won in another separate cluster.
  for (const pId of pendingIdsSet) {
    keeperIdsSet.delete(pId);
  }

  return {
    keeperIds: [...keeperIdsSet],
    pendingIds: [...pendingIdsSet],
    matches,
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
