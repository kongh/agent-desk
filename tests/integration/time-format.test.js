import assert from "node:assert/strict";
import test from "node:test";

import { formatElapsedTime, formatRelativeTime } from "../../apps/web/src/runtime/time-format.ts";

test("formats elapsed thinking time with compact units", () => {
  assert.equal(formatElapsedTime(13), "13s");
  assert.equal(formatElapsedTime(62), "1min 2s");
  assert.equal(formatElapsedTime(3662), "1h 1min 2s");
});


test("formats relative chat timestamps", () => {
  const now = new Date("2026-06-29T10:00:00.000Z");

  assert.equal(formatRelativeTime(new Date("2026-06-29T09:59:40.000Z"), now), "刚刚");
  assert.equal(formatRelativeTime(new Date("2026-06-29T09:58:00.000Z"), now), "2 分");
  assert.equal(formatRelativeTime(new Date("2026-06-29T07:00:00.000Z"), now), "3 时");
  assert.equal(formatRelativeTime(new Date("2026-06-26T10:00:00.000Z"), now), "3 天");
});
