import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGalleryBatchParams } from '../src/lib/gallery-feed.ts';

describe('/api/images API Contract & Server-side Pagination Verification', () => {
  it('parses valid pagination parameters and sets default limit to 48', () => {
    const params = new URLSearchParams('offset=0&limit=48');
    const parsed = parseGalleryBatchParams(params);

    assert.equal(parsed.offset, 0);
    assert.equal(parsed.limit, 48);
    assert.equal(parsed.sort, 'newest');
  });

  it('clamps requested limit to maximum 48 items per page', () => {
    const params = new URLSearchParams('offset=0&limit=200');
    const parsed = parseGalleryBatchParams(params);

    assert.equal(parsed.limit, 48, 'Should clamp limit to 48');
  });

  it('rejects invalid offset and sort parameters with error', () => {
    assert.throws(() => parseGalleryBatchParams(new URLSearchParams('offset=invalid')), /offset/);
    assert.throws(() => parseGalleryBatchParams(new URLSearchParams('sort=invalid_sort')), /sort/);
  });
});
