import assert from "node:assert/strict";
import test from "node:test";

import { latestPostSignature, newerThanLatest, samePostSignature } from "../scripts/media-items.mjs";

test("builds and compares latest post signatures", () => {
  const latest = latestPostSignature([
    { tweet_id: 123, date: "2026-07-04T01:02:03Z", url: "https://pbs.twimg.com/media/a.jpg" },
    { tweet_id: 122, date: "2026-07-03T01:02:03Z", url: "https://pbs.twimg.com/media/b.jpg" },
  ]);

  assert.deepEqual(latest, { postId: "123", date: "2026-07-04T01:02:03Z" });
  assert.equal(samePostSignature(latest, { postId: "123", date: "2026-07-04T01:02:03Z" }), true);
  assert.equal(samePostSignature(latest, { postId: "122", date: "2026-07-04T01:02:03Z" }), false);
});

test("keeps only media newer than the previous latest post", () => {
  const items = [
    { tweet_id: "130", url: "https://pbs.twimg.com/media/a.jpg" },
    { tweet_id: "129", url: "https://pbs.twimg.com/media/b.jpg" },
    { tweet_id: "123", url: "https://pbs.twimg.com/media/c.jpg" },
    { tweet_id: "122", url: "https://pbs.twimg.com/media/d.jpg" },
  ];

  assert.deepEqual(
    newerThanLatest(items, { postId: "123", date: "" }).map((item) => item.tweet_id),
    ["130", "129"],
  );
});
