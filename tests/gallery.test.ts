import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { preparePhotoSwipeItem, wrapSlideIndex } from '../src/lib/gallery.ts';

const baseLayoutSource = readFileSync(
  new URL('../src/layouts/BaseLayout.astro', import.meta.url),
  'utf8',
);

test('marks video items as HTML content for PhotoSwipe', () => {
  const item = preparePhotoSwipeItem(
    {
      src: '/api/r2/example.mp4',
      element: { getAttribute: (name: string) => name === 'data-video' ? '1' : null },
    },
    { width: 1280, height: 720 },
  );

  assert.equal(item.type, 'html');
  assert.equal(item.w, 1280);
  assert.equal(item.h, 720);
  assert.match(item.html, /<video/);
  assert.match(item.html, /src="\/api\/r2\/example\.mp4"/);
  assert.doesNotMatch(item.html, /autoplay/);
});

test('uses an image natural dimensions for PhotoSwipe', () => {
  const item = preparePhotoSwipeItem(
    {
      src: '/api/r2/portrait.webp',
      element: {
        getAttribute: () => null,
        querySelector: () => ({ naturalWidth: 1196, naturalHeight: 2048 }),
      },
    },
    { width: 1280, height: 720 },
  );

  assert.equal(item.w, 1402);
  assert.equal(item.h, 2400);
});

test('wraps card slider indexes in both directions', () => {
  assert.equal(wrapSlideIndex(-1, 2), 1);
  assert.equal(wrapSlideIndex(2, 2), 0);
  assert.equal(wrapSlideIndex(1, 2), 1);
});

test('keeps dynamically inserted PhotoSwipe video styles global', () => {
  assert.match(baseLayoutSource, /:global\(\.pswp__video-wrapper\)/);
  assert.match(baseLayoutSource, /:global\(\.pswp__video-wrapper video\)/);
});

test('opens PhotoSwipe with a fade instead of scaling the card thumbnail', () => {
  assert.match(baseLayoutSource, /showHideAnimationType:\s*['"]fade['"]/);
});

test('guards gallery links from native navigation before PhotoSwipe handles them', () => {
  assert.match(baseLayoutSource, /addEventListener\(['"]click['"],\s*guardGalleryClick,\s*true\)/);
  assert.match(baseLayoutSource, /function guardGalleryClick\([^)]+\)[\s\S]*?event\.preventDefault\(\)/);
});

test('waits for real dimensions before replaying an unloaded image click', () => {
  assert.match(baseLayoutSource, /function loadImageDimensions\(/);
  assert.match(baseLayoutSource, /link\.dataset\.pswpWidth\s*=\s*String\(width\)/);
  assert.match(baseLayoutSource, /link\.dataset\.pswpHeight\s*=\s*String\(height\)/);
  assert.match(baseLayoutSource, /link\.click\(\)/);
});
