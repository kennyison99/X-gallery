import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import {
  STORAGE_LIMIT_BYTES,
  getStorageTotal,
  reconcileStorage,
} from '../../lib/storage';

/**
 * GET /api/storage-stats
 * Returns the current R2 usage: { total_bytes, limit_bytes, percent, remaining_bytes }
 * If the counter is 0 (uninitialized), triggers a one-time reconcile so the
 * first read is accurate instead of showing 10GB free.
 *
 * POST /api/storage-stats
 * Force a full R2 list reconcile (admin "重新計算" button).
 */
export const GET: APIRoute = async () => {
  if (!env || !env.DB || !env.BUCKET) {
    return new Response(JSON.stringify({ error: 'D1 or R2 binding is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let total = await getStorageTotal();
    // First read after deployment: counter is 0 but R2 may already hold
    // objects. Reconcile once so the display is correct out of the box.
    if (total === 0) {
      total = await reconcileStorage();
    }

    const remaining = Math.max(0, STORAGE_LIMIT_BYTES - total);
    const percent = Math.min(100, (total / STORAGE_LIMIT_BYTES) * 100);

    return new Response(
      JSON.stringify({
        total_bytes: total,
        limit_bytes: STORAGE_LIMIT_BYTES,
        remaining_bytes: remaining,
        percent: Math.round(percent * 10) / 10,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async () => {
  if (!env || !env.DB || !env.BUCKET) {
    return new Response(JSON.stringify({ error: 'D1 or R2 binding is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const total = await reconcileStorage();
    const remaining = Math.max(0, STORAGE_LIMIT_BYTES - total);
    const percent = Math.min(100, (total / STORAGE_LIMIT_BYTES) * 100);

    return new Response(
      JSON.stringify({
        success: true,
        total_bytes: total,
        limit_bytes: STORAGE_LIMIT_BYTES,
        remaining_bytes: remaining,
        percent: Math.round(percent * 10) / 10,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
