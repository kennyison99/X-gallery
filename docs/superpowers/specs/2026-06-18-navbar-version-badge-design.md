# Navbar Version Badge

## Goal

Move the existing build version badge from the footer to the navbar, immediately
to the left of the light/dark theme button.

## Design

`BaseLayout.astro` remains responsible for reading
`PUBLIC_BUILD_VERSION`. It passes the resulting string to `Header.astro` as a
required `version` prop. `Header.astro` renders the existing badge styling in
the `.nav-actions` group before the theme button.

The footer keeps its existing text but no longer renders a version badge. The
badge remains compact, uses a monospace font, stays on one line, and works in
both light and dark themes without introducing a new color token.

Lazy loading is explicitly outside this change. The existing image and
PhotoSwipe loading behavior remains unchanged.

## Verification

- The navbar displays the build version immediately left of the theme button.
- The footer contains no build version badge.
- The navbar remains on one line at desktop and 390px mobile widths.
- The badge remains legible in light and dark themes.
- The Astro production build succeeds.
