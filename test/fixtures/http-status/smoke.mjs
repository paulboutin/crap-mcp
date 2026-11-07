import assert from "node:assert/strict";
import test from "node:test";
import { describeStatus } from "./status.ts";

test("200 means ok", () => assert.equal(describeStatus(200), "ok"));
