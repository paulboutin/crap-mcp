import assert from "node:assert/strict";
import test from "node:test";
import { describeStatus } from "./status.ts";

test("describes each supported status and falls back for unknown codes", () => {
  const expected = [
    [200, "ok"],
    [201, "created"],
    [204, "no content"],
    [301, "moved"],
    [400, "bad request"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not found"],
    [429, "rate limited"],
    [503, "unavailable"],
    [599, "unknown"],
  ];

  for (const [code, label] of expected)
    assert.equal(describeStatus(code), label);
});
