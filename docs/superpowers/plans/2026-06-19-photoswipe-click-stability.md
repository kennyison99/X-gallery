# PhotoSwipe Click Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open card media through PhotoSwipe without thumbnail zoom flicker, accidental native navigation, or image ratio changes.

**Architecture:** A document capture listener owns ordinary gallery-link navigation before PhotoSwipe's delegated listener. It waits for real lazy-image dimensions when required, then lets PhotoSwipe open the item with a fade transition and the measured aspect ratio.

**Tech Stack:** Astro 6, TypeScript, PhotoSwipe 5, Node test runner

---

### Task 1: Lock the behavior with tests

**Files:**
- Modify: `tests/gallery.test.ts`

- [x] Add assertions that the layout uses `showHideAnimationType: 'fade'`, installs a capture-phase gallery guard, and waits for missing image dimensions.
- [x] Run `node --test --experimental-strip-types tests/gallery.test.ts` and confirm the new assertions fail.

### Task 2: Stabilize gallery clicks

**Files:**
- Modify: `src/layouts/BaseLayout.astro`

- [x] Add a single capture-phase click guard for unmodified `a.gallery-link` clicks.
- [x] Always call `preventDefault()` for guarded clicks so PhotoSwipe state can never fall through to the media URL.
- [x] For an unloaded image, stop the current event, preload the media to obtain its natural dimensions, write `data-pswp-width` and `data-pswp-height`, and replay the click once.
- [x] Configure PhotoSwipe with `showHideAnimationType: 'fade'` so opening no longer scales the card thumbnail across the page.

### Task 3: Verify the complete flow

**Files:**
- Modify: `docs/superpowers/plans/2026-06-19-photoswipe-click-stability.md`

- [x] Run `node --test --experimental-strip-types tests/gallery.test.ts` and confirm all gallery tests pass.
- [x] Run the repository test suite and record any unrelated existing failures.
- [x] Run `npm run build` and confirm the production build succeeds.
- [ ] Browser-test image opening, rapid repeated clicks, carousel arrows, aspect ratio, and video opening. Blocked because the local D1 has no cards and the browser plugin cannot access its runtime under the active sandbox.
- [x] Confirm the production client bundle contains the click guard and fade option.
- [ ] Commit only the intended files.
