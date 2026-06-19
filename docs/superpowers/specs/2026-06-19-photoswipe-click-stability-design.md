# PhotoSwipe Click Stability Design

## Problem

Opening a card image can briefly enlarge the thumbnail over the card before the
lightbox settles. A gallery link can also occasionally follow its native `href`
and open the media file directly instead of opening PhotoSwipe.

## Design

- Use PhotoSwipe's fade opening animation so the card thumbnail is not promoted
  into a viewport-sized zoom animation.
- Install one gallery click guard before PhotoSwipe's delegated click handler.
  It always cancels native navigation for ordinary gallery clicks.
- If a lazy image does not have natural dimensions yet, wait for it to load and
  then replay the click once. PhotoSwipe therefore receives the real dimensions
  and keeps the original aspect ratio.
- Keep modifier-assisted link clicks unchanged so opening the media in a new tab
  remains an intentional browser action.
- Keep video slides on the existing PhotoSwipe HTML-content path.

## Verification

- Unit-test the dimension readiness helper and source-level lightbox options.
- Run the gallery tests and production build.
- Browser-test normal image opening, a rapid repeated click, card carousel
  navigation, image aspect ratio, and video opening.
