import assert from "node:assert/strict";
import test from "node:test";

import { resolveXtractorAsset } from "../scripts/xtractor-lib.mjs";

test("resolves the current platform asset from the latest xtractor release", async () => {
  const asset = await resolveXtractorAsset(async () => ({
    ok: true,
    json: async () => ({
      tag_name: "v9.9",
      assets: [
        {
          name: "linux-amd64.zip",
          digest: "sha256:abc123",
          browser_download_url: "https://example.test/linux-amd64.zip",
        },
      ],
    }),
  }), "linux", "x64");

  assert.deepEqual(asset, {
    version: "v9.9",
    url: "https://example.test/linux-amd64.zip",
    sha256: "abc123",
  });
});
