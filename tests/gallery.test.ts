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
