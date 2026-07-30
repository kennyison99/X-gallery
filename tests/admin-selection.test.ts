import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  rectOverlap,
  getSelectionRect,
  computePageSelectionState,
  applySelectionMode,
} from '../src/lib/admin-selection.ts';

test('rectOverlap correctly detects area overlap and returns false for touching edges/corners', () => {
  const rectA = { left: 10, top: 10, right: 50, bottom: 50 };

  // Overlapping
  assert.equal(rectOverlap(rectA, { left: 20, top: 20, right: 60, bottom: 60 }), true);
  assert.equal(rectOverlap(rectA, { left: 0, top: 0, right: 100, bottom: 100 }), true);

  // Separate
  assert.equal(rectOverlap(rectA, { left: 100, top: 100, right: 150, bottom: 150 }), false);

  // Touching edges (should be false)
  assert.equal(rectOverlap(rectA, { left: 50, top: 10, right: 100, bottom: 50 }), false);
  assert.equal(rectOverlap(rectA, { left: 10, top: 50, right: 50, bottom: 100 }), false);

  // Touching corners (should be false)
  assert.equal(rectOverlap(rectA, { left: 50, top: 50, right: 100, bottom: 100 }), false);
});

test('getSelectionRect normalizes arbitrary start and current coordinates', () => {
  const box1 = getSelectionRect(10, 20, 100, 200);
  assert.deepEqual(box1, { left: 10, top: 20, right: 100, bottom: 200, width: 90, height: 180 });

  // Drag in reverse direction
  const box2 = getSelectionRect(100, 200, 10, 20);
  assert.deepEqual(box2, { left: 10, top: 20, right: 100, bottom: 200, width: 90, height: 180 });
});

test('computePageSelectionState accurately calculates page selection status', () => {
  const visible = [1, 2, 3, 4, 5];

  // Empty page
  assert.deepEqual(computePageSelectionState([], new Set([1, 2])), {
    allSelected: false,
    noneSelected: true,
    partiallySelected: false,
    selectedOnPageCount: 0,
  });

  // None selected on page
  assert.deepEqual(computePageSelectionState(visible, new Set([99, 100])), {
    allSelected: false,
    noneSelected: true,
    partiallySelected: false,
    selectedOnPageCount: 0,
  });

  // Partially selected
  assert.deepEqual(computePageSelectionState(visible, new Set([2, 4, 99])), {
    allSelected: false,
    noneSelected: false,
    partiallySelected: true,
    selectedOnPageCount: 2,
  });

  // All selected on page (with cross-page items preserved)
  assert.deepEqual(computePageSelectionState(visible, new Set([1, 2, 3, 4, 5, 99])), {
    allSelected: true,
    noneSelected: false,
    partiallySelected: false,
    selectedOnPageCount: 5,
  });
});

test('applySelectionMode applies add and remove mode without mutating input sets', () => {
  const base = new Set([1, 2, 100]); // 100 is cross-page item
  const candidates = new Set([2, 3, 4]);

  // Add mode
  const added = applySelectionMode(base, candidates, 'add');
  assert.deepEqual(Array.from(added).sort((a, b) => a - b), [1, 2, 3, 4, 100]);
  assert.deepEqual(Array.from(base).sort((a, b) => a - b), [1, 2, 100]); // base unmutated

  // Remove mode
  const removed = applySelectionMode(base, candidates, 'remove');
  assert.deepEqual(Array.from(removed).sort((a, b) => a - b), [1, 100]);
  assert.deepEqual(Array.from(base).sort((a, b) => a - b), [1, 2, 100]); // base unmutated
});
