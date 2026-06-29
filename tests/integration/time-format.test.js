import assert from "node:assert/strict";
import test from "node:test";

import { formatElapsedTime } from "../../apps/web/src/runtime/time-format.ts";

test("formats elapsed thinking time with compact units", () => {
  assert.equal(formatElapsedTime(13), "13s");
  assert.equal(formatElapsedTime(62), "1min 2s");
  assert.equal(formatElapsedTime(3662), "1h 1min 2s");
});
