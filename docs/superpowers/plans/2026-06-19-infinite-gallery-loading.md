# Infinite Gallery Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Render 48 gallery posts initially, append 24 near the bottom, and restart from the correct end when sorting without traditional pagination.

**Architecture:** A shared server helper owns validated batch options and the existing D1 gallery query. The initial Astro page renders the first batch, while an Astro fragment endpoint renders later batches with the existing `ImageCard`; a small `IntersectionObserver` controller appends fragments and resets the feed on sort changes.

**Tech Stack:** Astro 6, TypeScript, Cloudflare Workers/D1, browser `IntersectionObserver`, Node test runner

---

## File Map

- Create `src/lib/gallery-feed.ts`: constants, request parsing, deterministic SQL construction, batch execution, and `hasMore` calculation.
- Create `src/pages/api/gallery.astro`: HTML fragment endpoint that reuses `ImageCard`.
- Create `tests/gallery-feed.test.ts`: pure helper tests and source-level integration contracts.
- Modify `src/pages/index.astro`: first-batch query, loading sentinel/status, incremental loading, filter reapplication, and sort reset.
- Modify `src/layouts/BaseLayout.astro`: re-run slider initialization after cards are appended.
- Modify `docs/superpowers/plans/2026-06-19-infinite-gallery-loading.md`: record completed verification.

### Task 1: Define and test gallery batch rules

**Files:**
- Create: `tests/gallery-feed.test.ts`
- Create: `src/lib/gallery-feed.ts`

- [x] **Step 1: Write failing tests for request parsing and batch boundaries**

Create `tests/gallery-feed.test.ts` with:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

const feed = await import('../src/lib/gallery-feed.ts').catch(() => ({}));
const parseGalleryBatchParams = feed.parseGalleryBatchParams ?? (() => undefined);
const takeGalleryBatch = feed.takeGalleryBatch ?? (() => undefined);

test('parses a valid oldest batch and caps its limit at 48', () => {
  const params = new URLSearchParams('sort=oldest&offset=48&limit=100&tag=art&author=alice');
  assert.deepEqual(parseGalleryBatchParams(params), {
    sort: 'oldest', offset: 48, limit: 48, tag: 'art', author: 'alice',
  });
});

test('defaults the initial feed to newest offset zero and 48 posts', () => {
  assert.deepEqual(parseGalleryBatchParams(new URLSearchParams()), {
    sort: 'newest', offset: 0, limit: 48, tag: null, author: null,
  });
});

test('rejects invalid sort and offset values', () => {
  assert.throws(() => parseGalleryBatchParams(new URLSearchParams('sort=random')), /sort/);
  assert.throws(() => parseGalleryBatchParams(new URLSearchParams('offset=-1')), /offset/);
});

test('uses one extra row to report whether another batch exists', () => {
  const rows = Array.from({ length: 25 }, (_, id) => ({ id }));
  assert.deepEqual(takeGalleryBatch(rows, 24), { items: rows.slice(0, 24), hasMore: true });
  assert.deepEqual(takeGalleryBatch(rows.slice(0, 24), 24), { items: rows.slice(0, 24), hasMore: false });
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
rtk proxy node --test --experimental-strip-types tests/gallery-feed.test.ts
```

Expected: FAIL because `parseGalleryBatchParams` and `takeGalleryBatch` do not exist.

- [x] **Step 3: Implement the minimal pure helpers**

Create `src/lib/gallery-feed.ts` with:

```ts
export const INITIAL_GALLERY_LIMIT = 48;
export const GALLERY_BATCH_LIMIT = 24;
export const MAX_GALLERY_LIMIT = 48;

export type GallerySort = 'newest' | 'oldest';
export interface GalleryBatchParams {
  sort: GallerySort;
  offset: number;
  limit: number;
  tag: string | null;
  author: string | null;
}

function integerParam(value: string | null, fallback: number, name: string): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${name}`);
  return Number(value);
}

export function parseGalleryBatchParams(params: URLSearchParams): GalleryBatchParams {
  const sort = params.get('sort') ?? 'newest';
  if (sort !== 'newest' && sort !== 'oldest') throw new Error('Invalid sort');
  const offset = integerParam(params.get('offset'), 0, 'offset');
  const requestedLimit = integerParam(params.get('limit'), INITIAL_GALLERY_LIMIT, 'limit');
  if (requestedLimit < 1) throw new Error('Invalid limit');
  return {
    sort,
    offset,
    limit: Math.min(requestedLimit, MAX_GALLERY_LIMIT),
    tag: params.get('tag'),
    author: params.get('author'),
  };
}

export function takeGalleryBatch<T>(rows: T[], limit: number) {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2.

Expected: all four tests PASS.

### Task 2: Move the gallery query behind the tested batch boundary

**Files:**
- Modify: `tests/gallery-feed.test.ts`
- Modify: `src/lib/gallery-feed.ts`
- Modify: `src/pages/index.astro`

- [x] **Step 1: Add failing tests for deterministic query construction**

Add assertions that `buildGalleryQuery()`:

```ts
const buildGalleryQuery = feed.buildGalleryQuery ?? (() => ({ sql: '', bindings: [] }));

test('builds a newest unfiltered query with a stable id tie breaker', () => {
  const query = buildGalleryQuery(parseGalleryBatchParams(new URLSearchParams()));
  assert.match(query.sql, /WHERE i\.published = 1/);
  assert.match(query.sql, /ORDER BY i\.created_at DESC, i\.id DESC/);
  assert.match(query.sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(query.bindings, [49, 0]);
});

test('binds filters before batch controls and reverses both sort keys', () => {
  const options = parseGalleryBatchParams(new URLSearchParams('sort=oldest&offset=48&limit=24&author=alice'));
  const query = buildGalleryQuery(options);
  assert.match(query.sql, /WHERE i\.author = \? AND i\.published = 1/);
  assert.match(query.sql, /ORDER BY i\.created_at ASC, i\.id ASC/);
  assert.deepEqual(query.bindings, ['alice', 25, 48]);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Expected: FAIL because `buildGalleryQuery` does not exist.

- [x] **Step 3: Implement query construction and execution**

Implement `buildGalleryQuery(options)` with the three existing filter shapes and stable ordering:

```ts
export function buildGalleryQuery(options: GalleryBatchParams) {
  const direction = options.sort === 'oldest' ? 'ASC' : 'DESC';
  const bindings: unknown[] = [];
  let joins = `
    LEFT JOIN image_tags it ON i.id = it.image_id
    LEFT JOIN tags t ON it.tag_id = t.id`;
  let where = 'i.published = 1';
  let tags = 'group_concat(t.name)';

  if (options.tag) {
    joins = `
      JOIN image_tags selected_it ON i.id = selected_it.image_id
      JOIN tags selected_tag ON selected_it.tag_id = selected_tag.id
      LEFT JOIN image_tags it ON i.id = it.image_id
      LEFT JOIN tags t ON it.tag_id = t.id`;
    where = 'selected_tag.name = ? AND i.published = 1';
    bindings.push(options.tag);
  } else if (options.author) {
    where = 'i.author = ? AND i.published = 1';
    bindings.push(options.author);
  }

  bindings.push(options.limit + 1, options.offset);
  return {
    sql: `
      SELECT i.*, ${tags} AS tags_list
      FROM images i
      ${joins}
      WHERE ${where}
      GROUP BY i.id
      ORDER BY i.created_at ${direction}, i.id ${direction}
      LIMIT ? OFFSET ?`,
    bindings,
  };
}

export async function fetchGalleryBatch(db: GalleryDatabase, options: GalleryBatchParams) {
  const { sql, bindings } = buildGalleryQuery(options);
  const { results = [] } = await db.prepare(sql).bind(...bindings).all<Record<string, unknown>>();
  return takeGalleryBatch(results, options.limit);
}
```

Use a minimal structural D1 type instead of adding a dependency:

```ts
interface GalleryDatabase {
  prepare(sql: string): {
    bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> };
  };
}
```

- [x] **Step 4: Replace the unbounded homepage query**

In `src/pages/index.astro`, construct a new parameter set so URL-supplied `offset` and `limit` cannot change the initial batch:

```ts
const initialParams = new URLSearchParams();
if (activeTag) initialParams.set('tag', activeTag);
if (activeAuthor) initialParams.set('author', activeAuthor);
const batchOptions = parseGalleryBatchParams(initialParams);
const { items: images, hasMore } = await fetchGalleryBatch(env.DB, batchOptions);
```

Delete the three inline unbounded image queries. Keep the existing author/tag list queries and tag formatting so visible behavior stays unchanged.

- [x] **Step 5: Run focused tests and the Astro type checker**

Run:

```powershell
rtk proxy node --test --experimental-strip-types tests/gallery-feed.test.ts
rtk proxy npx astro check
```

Expected: tests PASS and Astro reports no new errors.

### Task 3: Add the reusable HTML fragment endpoint

**Files:**
- Modify: `tests/gallery-feed.test.ts`
- Create: `src/pages/api/gallery.astro`

- [x] **Step 1: Add a failing endpoint contract test**

Read the new endpoint source and assert that it imports `ImageCard`, calls `parseGalleryBatchParams` and `fetchGalleryBatch`, returns `400` for invalid parameters, and exposes `data-count` plus `data-has-more` on one batch wrapper.

```ts
const endpointSource = readFileSync(new URL('../src/pages/api/gallery.astro', import.meta.url), 'utf8');
assert.match(endpointSource, /import ImageCard/);
assert.match(endpointSource, /parseGalleryBatchParams/);
assert.match(endpointSource, /status:\s*400/);
assert.match(endpointSource, /data-has-more/);
```

- [x] **Step 2: Run the focused test and verify RED**

Expected: FAIL with `ENOENT` for `src/pages/api/gallery.astro`.

- [x] **Step 3: Implement the Astro fragment route**

Use this route structure in the frontmatter:

```astro
---
import { env } from 'cloudflare:workers';
import ImageCard from '../../components/ImageCard.astro';
import { fetchGalleryBatch, parseGalleryBatchParams } from '../../lib/gallery-feed';

if (!env?.DB) return new Response('D1 DB binding is not configured', { status: 500 });

let options;
try {
  options = parseGalleryBatchParams(Astro.url.searchParams);
} catch (error) {
  return new Response(error instanceof Error ? error.message : 'Invalid request', { status: 400 });
}

const [{ items: images, hasMore }, authorsQuery] = await Promise.all([
  fetchGalleryBatch(env.DB, options),
  env.DB.prepare('SELECT DISTINCT author FROM images WHERE published = 1').all(),
]);
const authorSet = new Set(authorsQuery.results.map((row: any) => String(row.author).toLowerCase()));
const formattedImages = images.map((image: any) => ({
  ...image,
  tags: image.tags_list
    ? String(image.tags_list).split(',').filter((tag) => !authorSet.has(tag.trim().toLowerCase()))
    : [],
}));
---
```

Render only a wrapper and cards, with no layout:

```astro
<div class="gallery-batch" data-count={formattedImages.length} data-has-more={hasMore ? 'true' : 'false'}>
  {formattedImages.map((image) => <ImageCard image={image} />)}
</div>
```

- [x] **Step 4: Run focused tests and `astro check`**

Expected: all focused tests PASS and the endpoint type-checks.

### Task 4: Implement incremental loading and correct sort reset

**Files:**
- Modify: `tests/gallery-feed.test.ts`
- Modify: `src/pages/index.astro`
- Modify: `src/layouts/BaseLayout.astro`

- [x] **Step 1: Add failing source contracts for browser behavior**

Assert that the homepage contains `IntersectionObserver`, a nonzero `rootMargin`, `INITIAL_GALLERY_LIMIT`, `GALLERY_BATCH_LIMIT`, `replaceChildren` for sort reset, and a `gallery:updated` event. Assert that `BaseLayout.astro` listens for `gallery:updated` and invokes `initSliders()`.

- [x] **Step 2: Run the focused test and verify RED**

Expected: FAIL because the observer and update event are absent.

- [x] **Step 3: Add loading UI after the grid**

Render these stable anchors whenever the gallery has cards:

```astro
<div id="gallery-sentinel" aria-hidden="true"></div>
<div id="gallery-status" role="status" aria-live="polite" hidden></div>
<button id="gallery-retry" type="button" class="btn" hidden>?岫頛</button>
```

Expose initial state through `data-offset={formattedImages.length}` and `data-has-more={hasMore}` on `.image-grid`.

- [x] **Step 4: Make card initialization idempotent**

Update `setupLikes()` so it only binds cards without `data-like-initialized`, then sets that attribute. Extract the current media filtering body into `applyMediaFilter()` so it can run both after a filter click and after appending cards.

- [x] **Step 5: Add the feed controller**

Add one controller with:

```ts
const INITIAL_LIMIT = 48;
const BATCH_LIMIT = 24;
let offset = Number(grid.dataset.offset ?? 0);
let hasMore = grid.dataset.hasMore === 'true';
let loading = false;
let sort: 'newest' | 'oldest' = 'newest';
```

Implement `fetchBatch({ reset })` with this request and state transition:

```ts
const params = new URLSearchParams({
  offset: String(reset ? 0 : offset),
  limit: String(reset ? INITIAL_LIMIT : BATCH_LIMIT),
  sort,
});
if (activeTag) params.set('tag', activeTag);
if (activeAuthor) params.set('author', activeAuthor);

const response = await fetch(`/api/gallery?${params}`);
if (!response.ok) throw new Error(`Gallery request failed: ${response.status}`);
const documentFragment = new DOMParser().parseFromString(await response.text(), 'text/html');
const batch = documentFragment.querySelector<HTMLElement>('.gallery-batch');
if (!batch) throw new Error('Gallery batch is missing');
const cards = Array.from(batch.querySelectorAll<HTMLElement>('.image-card'));
if (reset) grid.replaceChildren(...cards);
else grid.append(...cards);
offset = (reset ? 0 : offset) + Number(batch.dataset.count ?? cards.length);
hasMore = batch.dataset.hasMore === 'true';
```

The surrounding `try/catch/finally` must:

- Ignore concurrent calls and completed non-reset feeds.
- Request `/api/gallery` with `offset=0&limit=48` for reset or the current offset with `limit=24` for append.
- Include active `tag`, `author`, and `sort` parameters.
- Parse `.gallery-batch`, then `replaceChildren(...cards)` on reset or append cards otherwise.
- Advance `offset` by the returned `data-count`, update `hasMore`, rerun likes/media filtering, and dispatch `new CustomEvent('gallery:updated')`.
- On failure, expose the retry button without deleting loaded cards.
- Always clear the loading flag and disconnect the observer once `hasMore` is false.

Create the observer with an early trigger:

```ts
const observer = new IntersectionObserver(
  (entries) => {
    if (entries.some((entry) => entry.isIntersecting)) void fetchBatch({ reset: false });
  },
  { rootMargin: '800px 0px' },
);
```

Replace the existing in-DOM sorting block. A sort selection must set the selected order and call `fetchBatch({ reset: true })`.

- [x] **Step 6: Reinitialize only newly added sliders**

In `BaseLayout.astro`, retain the existing `data-slider-initialized` guard and add:

```ts
document.addEventListener('gallery:updated', initSliders);
```

PhotoSwipe needs no recreation because its delegated gallery selector resolves the clicked fragment at click time.

- [x] **Step 7: Run focused tests and `astro check`**

Expected: all new behavior contracts PASS and no new Astro errors appear.

### Task 5: Verify regression safety and performance behavior

**Files:**
- Modify: `docs/superpowers/plans/2026-06-19-infinite-gallery-loading.md`

- [x] **Step 1: Run the complete test suite**

Run:

```powershell
rtk proxy node --test --experimental-strip-types tests/*.test.ts
```

Expected: all repository tests PASS.

- [x] **Step 2: Build the production worker**

Run:

```powershell
rtk npm run build
```

Expected: Astro production build succeeds without errors.

- [x] **Step 3: Start the local Worker and verify HTTP batches**

Run the preview/Worker command supported by this checkout, then verify:

- `/` contains exactly 48 `.image-card` elements.
- `/api/gallery?offset=48&limit=24&sort=newest` contains exactly 24 cards.
- `/api/gallery?offset=0&limit=48&sort=oldest` starts at the oldest published row.
- Invalid sort/negative offset requests return `400`.

- [x] **Step 4: Browser-test the continuous feed**

Verify that approaching the bottom appends 24 cards once, current photo/video filtering applies to appended cards, a failed request exposes retry, and switching sort replaces the grid with 48 cards from the selected end.

- [x] **Step 5: Compare the initial payload**

Record initial card count and HTML response size before/after. The completed implementation must reduce the initial card count from 3,626 to 48 and avoid requests for media belonging only to unloaded posts.

- [x] **Step 6: Inspect the final diff**

Run:

```powershell
rtk git diff --check
rtk git status --short
```

Expected: no whitespace errors; only the planned source, test, spec, and plan files are changed. Existing untracked `.check-r2.*.log` files remain untouched.

## Execution Results

- Node test suite: 43 passed, 0 failed.
- Production build: passed with Astro 6 and the Cloudflare adapter.
- `astro check`: unavailable because this repository does not install `@astrojs/check`; no dependency was added, and the production build was used as the compiler gate.
- HTTP runtime: initial response 48 cards and 121,985 bytes; append fragment 24 cards; invalid parameters return 400.
- Browser runtime: scrolling changed the grid from 48 to 72 cards; oldest sort reset it to 48 with D1's oldest row (`id=3849`, `2019-03-08T13:39:19`).
- Browser filtering: after another 24-card append, all visible cards under the video filter had video media; browser console had 0 errors and 0 warnings.
