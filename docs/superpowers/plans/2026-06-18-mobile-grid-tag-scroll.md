# Mobile Grid and Tag Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the mobile image grid at two visible columns and make the tag filter horizontally scrollable.

**Architecture:** Fix the shared width constraint at the `main.container` flex item instead of patching the grid and tag component separately. Reproduce and verify the behavior with local D1 fixture data and browser geometry assertions at a 390px viewport.

**Tech Stack:** Astro 6, CSS Grid, Cloudflare D1 local development, in-app Chromium browser

---

### Task 1: Constrain the Main Content Flex Item

**Files:**
- Modify: `src/layouts/BaseLayout.astro`
- Verify: local D1 fixture and browser geometry at 390px

- [x] **Step 1: Load a temporary local fixture**

Create a temporary SQL file containing five long tags, four published images,
and their `image_tags` associations. Load it only into local D1:

```powershell
rtk npx wrangler d1 execute gallery-db --local --file=.tmp-layout-fixture.sql
```

Expected: three SQL operations succeed against `Resource location: local`.

- [x] **Step 2: Run the browser reproduction and verify it fails**

At a 390x844 viewport, read bounding rectangles and scroll dimensions for
`main.container`, `.image-grid`, the first two `.image-card` elements, and
`.tag-filter-container`.

Expected before the fix:

```text
main width > 390
grid width > 390
first card width > 300
second card x > 390
tag filter clientWidth == tag filter scrollWidth
```

- [x] **Step 3: Implement the minimal CSS fix**

Add the following declarations to the existing scoped `main` rule in
`src/layouts/BaseLayout.astro`:

```css
main {
  flex: 1;
  width: 100%;
  min-width: 0;
  padding-bottom: 3rem;
}
```

- [x] **Step 4: Re-run browser geometry assertions**

Reload the local page at 390x844 and verify:

```text
main width <= 390
grid right edge <= 366
first card y == second card y
first card x < second card x
each card width < 170
tag filter clientWidth < tag filter scrollWidth
```

Set `.tag-filter-container.scrollLeft = 100` through browser interaction and
verify its resulting `scrollLeft` is greater than zero.

- [x] **Step 5: Remove the local fixture**

Delete fixture `image_tags`, images, and tags from local D1, then remove the
temporary SQL file. Confirm the fixture query returns zero rows.

- [x] **Step 6: Run repository verification**

```powershell
rtk npm run build
rtk git diff --check
```

Expected: Astro production build exits 0 and `git diff --check` reports no
errors.

- [x] **Step 7: Commit the implementation**

```powershell
rtk git add src/layouts/BaseLayout.astro docs/superpowers/plans/2026-06-18-mobile-grid-tag-scroll.md
rtk git commit -m "fix: constrain mobile gallery layout"
```
