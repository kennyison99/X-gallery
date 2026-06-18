import assert from 'node:assert/strict';
import test from 'node:test';

import { dedupeMediaItems } from '../scripts/media-items.mjs';

test('removes duplicate media returned for the same tweet', () => {
  const duplicateUrl = 'https://video.twimg.com/ext_tw_video/177/test/video.mp4?tag=12';
  const items = [
    { tweet_id: '177', url: duplicateUrl, type: 'video' },
    { tweet_id: '177', url: duplicateUrl, type: 'video' },
  ];

  assert.deepEqual(dedupeMediaItems(items), [items[0]]);
});

test('preserves distinct media within one tweet', () => {
  const items = [
    { tweet_id: '177', url: 'https://pbs.twimg.com/media/first.jpg', type: 'photo' },
    { tweet_id: '177', url: 'https://pbs.twimg.com/media/second.jpg', type: 'photo' },
  ];

  assert.deepEqual(dedupeMediaItems(items), items);
});

test('preserves the same media identity when it belongs to different tweets', () => {
  const url = 'https://video.twimg.com/ext_tw_video/177/test/video.mp4';
  const items = [
    { tweet_id: '177', url, type: 'video' },
    { tweet_id: '188', url, type: 'video' },
  ];

  assert.deepEqual(dedupeMediaItems(items), items);
});
