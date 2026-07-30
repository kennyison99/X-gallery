import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyMediaKeys } from '../src/lib/media-classifier.ts';

test('classifyMediaKeys accurately counts photo and video keys', () => {
  const result1 = classifyMediaKeys('img1.jpg, img2.png, video1.mp4, video2.MOV, image3.webp');
  assert.equal(result1.photoCount, 3);
  assert.equal(result1.videoCount, 2);

  const result2 = classifyMediaKeys('  video.webm , clip.m4v  ');
  assert.equal(result2.photoCount, 0);
  assert.equal(result2.videoCount, 2);

  const result3 = classifyMediaKeys('');
  assert.equal(result3.photoCount, 0);
  assert.equal(result3.videoCount, 0);

  const result4 = classifyMediaKeys(null as any);
  assert.equal(result4.photoCount, 0);
  assert.equal(result4.videoCount, 0);
});
