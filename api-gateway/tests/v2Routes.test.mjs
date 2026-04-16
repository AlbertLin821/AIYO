import assert from "node:assert/strict";
import { __v2Internals } from "../src/v2Routes.js";

function run(name, fn) {
  try {
    fn();
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok - ${name}\n`);
    throw error;
  }
}

run("normalizeTraceId keeps valid trace ids and normalizes case", () => {
  const out = __v2Internals.normalizeTraceId("ABCDEF012345");
  assert.equal(out, "abcdef012345");
});

run("normalizeTraceId generates fallback for invalid input", () => {
  const out = __v2Internals.normalizeTraceId("bad-trace-id");
  assert.match(out, /^[a-f0-9]{32}$/);
});

run("hasLegacyPlaceId detects deprecated placeId recursively", () => {
  const payload = {
    a: [{ x: 1 }, { nested: { placeId: "legacy-id" } }]
  };
  assert.equal(__v2Internals.hasLegacyPlaceId(payload), true);
  assert.equal(__v2Internals.hasLegacyPlaceId({ a: { b: 1 } }), false);
});

run("normalizeRenderableItem maps contract fields", () => {
  const out = __v2Internals.normalizeRenderableItem({
    internal_place_id: "11111111-1111-1111-1111-111111111111",
    google_place_id: "g-1",
    segment_id: "22222222-2222-2222-2222-222222222222",
    lat: 25.03,
    lng: 121.56,
    start_sec: 30,
    end_sec: 90,
    reason: ["query_match"],
    stats_updated_at: "2026-04-10T00:00:00.000Z",
    stats_stale: false
  });
  assert.equal(out.internalPlaceId, "11111111-1111-1111-1111-111111111111");
  assert.equal(out.googlePlaceId, "g-1");
  assert.equal(out.segmentId, "22222222-2222-2222-2222-222222222222");
  assert.equal(out.startSec, 30);
  assert.equal(out.endSec, 90);
  assert.deepEqual(out.reason, ["query_match"]);
});

run("normalizeRenderableItem rejects legacy placeId", () => {
  assert.throws(
    () => __v2Internals.normalizeRenderableItem({ placeId: "old-id" }),
    /legacy placeId/
  );
});

process.stdout.write("All v2Routes tests passed.\n");
