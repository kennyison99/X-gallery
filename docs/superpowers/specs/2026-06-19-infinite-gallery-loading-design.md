# Infinite Gallery Loading Design

## Goal

Prevent the gallery from rendering all published posts and media at once while preserving a continuous, unpaginated browsing experience.

## Behavior

- Render the first 48 posts with the initial page response.
- When a sentinel approaches the viewport, request and append the next 24 posts.
- Stop requesting after the server reports that no more posts remain.
- Preserve the active `tag` and `author` filters in every batch request.
- Switching between newest and oldest clears the current cards and loads the selected ordering again from offset zero.
- The photo/video filter applies to all currently loaded cards and is reapplied after each appended batch.
- Display a retry control when a batch request fails. Do not discard cards already loaded.

## Architecture

The initial Astro page keeps server-rendering its first batch for fast first content and no-JavaScript fallback. A small JSON API accepts the existing filters plus `sort`, `offset`, and a server-capped `limit`. It returns rendered card data and a `hasMore` flag.

The browser owns only incremental loading state: current offset, active sort, loading/error status, and `hasMore`. An `IntersectionObserver` watches a sentinel below the grid. Only one request may be active at a time.

The API uses the same gallery query semantics as the initial page, with deterministic ordering by `created_at` and `id`. The query fetches one extra row to calculate `hasMore` without a separate count query.

## Components

- A shared gallery query helper builds and executes the filtered, ordered, bounded D1 query.
- The initial page calls the helper with a limit of 48.
- The batch API caps requests at 48 so a sort reset can replace the grid with a full initial batch; ordinary observer-triggered requests use 24.
- A reusable card renderer or compact HTML response avoids duplicating the `ImageCard` markup.
- The existing page script appends batches, initializes sliders for new cards, restores likes, and reapplies the active media filter.

## Error Handling

- Invalid `sort`, `offset`, or `limit` values return `400` or are clamped to safe server limits.
- Concurrent observer callbacks are ignored while a request is active.
- Network/API failures show a retry button and leave the existing gallery intact.
- An empty batch marks the feed complete and disconnects the observer.

## Verification

- Unit tests cover parameter parsing, deterministic query options, batch sizes, and `hasMore` calculation.
- API tests cover filter preservation and invalid inputs where practical with the existing test setup.
- The production build and complete existing test suite must pass.
- Runtime verification confirms the initial response contains 48 cards, scrolling appends 24, sorting restarts from the correct end, and no duplicate requests occur.

## Deliberate Limits

- No URL page numbers or browser-history entries are added for each batch.
- No client virtualization library or new dependency is introduced.
- Media-type filtering remains client-side over loaded cards; it does not skip unseen batches.
