# Admin Dashboard Tabs Design

## Goal

Turn the existing CMS admin page into a clearer single-page dashboard with hash-addressable top tabs, an overview, and consistent author names in `nick@handle` format.

## Scope

The admin page will contain five top tabs:

1. `#overview` - summary metrics and quick actions
2. `#posts` - published and pending post management
3. `#upload` - create and edit post form
4. `#crawler` - crawl account management
5. `#auto-tag` - auto-tag operations

The work does not change homepage gallery rendering, PhotoSwipe behavior, crawler scheduling, or the media upload contract.

## Navigation Behavior

- Tabs remain within `/admin`; switching tabs does not reload the page.
- The URL hash is the source of truth for the active tab.
- Empty or unsupported hashes resolve to `#overview`.
- Browser back and forward navigation updates the visible tab.
- Refreshing the page preserves the selected tab.
- Overview quick actions update the hash and open the corresponding tab.
- On narrow screens, the top tab row scrolls horizontally without causing page-level horizontal overflow.

## Overview

The overview uses existing server data and APIs only. It shows:

- total post count
- pending-review count
- configured and enabled crawl-account counts
- R2 used capacity and percentage
- quick actions for creating a post, reviewing pending posts, managing crawler accounts, and running auto-tag

No new reporting service or GitHub API integration is introduced. Values that cannot be obtained from existing data are not displayed as live status.

## Author Model

`author` remains the canonical Twitter/X handle and is stored without any leading `@`. `author_display_name` remains the optional nick/display name.

All author inputs are normalized by trimming whitespace and removing every leading `@`. Display follows one shared rule:

- display name present: `笨蛋愛麗絲@ailisidabendan`
- display name absent: `@ailisidabendan`

The shared format is used by the post table, grid cards, author filter, and editor. Admin search matches both display name and handle. The create/edit form exposes an optional author display-name field and sends it through both create and update APIs.

Normalization is enforced at the API boundary, while presentation also normalizes defensively. This prevents malformed or stale values from producing `@@handle`.

## Component Boundaries

The large admin page will be split into focused Astro components while preserving existing API contracts and behavior:

- dashboard shell and top-tab navigation
- overview panel
- post-management panel
- upload/edit panel
- crawl-account panel
- auto-tag panel

Shared client utilities own tab resolution and author formatting/normalization. Existing post filtering, pagination, selection, view toggle, editing, approval, deletion, crawl-account operations, storage refresh, and auto-tag progress remain functionally unchanged.

## State And Error Handling

- Invalid hashes fall back to overview and replace the URL with `#overview`.
- Missing display names fall back to `@handle` without blank or undefined text.
- Empty handles remain invalid at API validation boundaries.
- Existing async operation error messages and progress indicators remain visible inside their owning tab.
- Switching tabs does not clear form, filter, pagination, or selection state during the page session.

## Accessibility And Responsive Behavior

- Tabs use tab semantics with keyboard focus visibility and selected-state attributes.
- Every tab controls a labelled tab panel.
- Interactive controls retain visible hover, focus, disabled, and progress states.
- Motion respects `prefers-reduced-motion`.
- The layout is verified at 375, 768, 1024, and 1440 pixel widths.

## Verification

Automated tests cover:

- stripping whitespace and multiple leading `@` characters
- formatting authors with and without display names
- searchable author text containing both nick and handle
- valid, empty, and invalid hash resolution

Integration verification includes the full Node test suite and production Astro build. Browser checks cover tab switching, direct hash loading, refresh, back/forward navigation, quick actions, author filtering/search, create/edit forms, desktop layout, and mobile horizontal tab scrolling.
