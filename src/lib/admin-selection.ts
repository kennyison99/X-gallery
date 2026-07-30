export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SelectionBoxRect extends Rect {
  width: number;
  height: number;
}

export interface PageSelectionState {
  allSelected: boolean;
  noneSelected: boolean;
  partiallySelected: boolean;
  selectedOnPageCount: number;
}

/**
 * Checks if two rectangles overlap with strict area intersection.
 * Touching edges or corners without intersecting area return false.
 */
export function rectOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Computes a normalized selection box rectangle from start and current pointer coordinates.
 */
export function getSelectionRect(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number
): SelectionBoxRect {
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  const right = Math.max(startX, currentX);
  const bottom = Math.max(startY, currentY);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * Evaluates selection state for items rendered on the current active view.
 */
export function computePageSelectionState(
  visibleItemIds: number[],
  selectedIds: Set<number>
): PageSelectionState {
  if (visibleItemIds.length === 0) {
    return {
      allSelected: false,
      noneSelected: true,
      partiallySelected: false,
      selectedOnPageCount: 0,
    };
  }

  let selectedOnPageCount = 0;
  for (const id of visibleItemIds) {
    if (selectedIds.has(id)) {
      selectedOnPageCount++;
    }
  }

  const allSelected = selectedOnPageCount === visibleItemIds.length;
  const noneSelected = selectedOnPageCount === 0;
  const partiallySelected = !allSelected && !noneSelected;

  return {
    allSelected,
    noneSelected,
    partiallySelected,
    selectedOnPageCount,
  };
}

/**
 * Applies drag selection mode ('add' or 'remove') to candidate item IDs based on a snapshot of base selected IDs.
 * Does NOT mutate baseSelection or candidateIds, and preserves cross-page selected IDs.
 */
export function applySelectionMode(
  baseSelection: Set<number>,
  candidateIds: Set<number>,
  mode: 'add' | 'remove'
): Set<number> {
  const nextSelection = new Set<number>(baseSelection);

  if (mode === 'add') {
    for (const id of candidateIds) {
      nextSelection.add(id);
    }
  } else {
    for (const id of candidateIds) {
      nextSelection.delete(id);
    }
  }

  return nextSelection;
}
