# Mobile Grid and Tag Scroll Fix

## Problem

At a 390px viewport, the page's `main.container` expands to the intrinsic width
of its children. In the reproduced fixture it became about 1122px wide. The
image grid still has two columns, but each card becomes about 555px wide, so the
second card is outside the viewport. The tag filter expands to the same width,
leaving no internal overflow for horizontal scrolling.

## Design

Constrain only the main content flex item with `width: 100%` and `min-width: 0`.
This lets it shrink to the viewport while preserving the existing two-column
mobile grid and the tag filter's `overflow-x: auto` behavior. Header and footer
containers remain unchanged.

No component markup, breakpoints, card sizing, or tag interaction behavior will
change.

## Verification

Use a content-rich local fixture and a 390px browser viewport to verify:

- the main content and image grid do not exceed the viewport;
- the first two cards occupy separate columns in the same row;
- each card is narrower than half of the content width after accounting for the
  grid gap;
- the tag filter remains viewport-width and has `scrollWidth > clientWidth`;
- horizontal scrolling changes the tag filter's scroll position;
- the production build succeeds.

The fixture must use only local D1 data and must be removed after verification.
