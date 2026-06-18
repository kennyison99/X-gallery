# Admin Batch Progress

## Goals

- Let an administrator rerun auto-tagging for all existing images.
- Show server-confirmed progress for auto-tagging and bulk deletion.
- Preserve manually assigned tags and make auto-tagging safe to rerun.

## Auto-tag Backfill

Add a POST endpoint under `/admin/api/auto-tag`. Each request accepts an image
ID cursor and processes at most 50 images in ascending ID order. The endpoint
uses `generateAutoTags(author, description)`, creates missing tags, and inserts
missing `image_tags` links with `INSERT OR IGNORE`.

The response contains the number scanned in the current batch, the total image
count, the number of new links added, the next cursor, and a `done` flag. It
does not remove or replace any existing tag link. Repeating any request or
rerunning the whole operation is idempotent.

The admin page starts at cursor zero and requests batches sequentially. It
shows a native progress bar and cumulative text such as "已掃描 150 / 755，已新增
20 個標籤關聯". The button remains disabled until completion or failure.

## Bulk Delete Progress

Keep the existing bulk-delete endpoint contract. The browser splits selected
image IDs into groups of 50 and sends one group at a time. The progress bar
advances only after the server confirms that a group was deleted.

Deletion is intentionally partially committable: if a later group fails,
earlier confirmed groups remain deleted. The page reports the confirmed count
and reloads so its rows match the database. The confirmation dialog explicitly
states that deletion cannot be undone.

## Shared UI Behavior

Auto-tagging and bulk deletion have separate native `<progress>` elements and
status text. Only the controls for the active operation are disabled. Progress
containers are hidden until their operation starts and remain visible with a
success or error summary afterward.

Cloudflare Access remains the external authentication boundary for admin pages
and the `/admin/api/auto-tag` endpoint.

## Verification

- Auto-tag batches advance the cursor without skipping images.
- Repeating auto-tagging creates no duplicate links and preserves manual tags.
- Auto-tag progress reflects server-confirmed scanned counts.
- Bulk delete sends at most 50 IDs per request and advances only after success.
- A failed bulk-delete batch reports partial completion and reloads the page.
- Both progress displays fit the existing desktop and mobile admin layout.
- Unit tests and the Astro production build pass.
