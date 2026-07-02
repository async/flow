import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as helpers from "../src/helpers.js";
import * as coreHelpers from "../src/helpers/core.js";

test("helpers and helpers/core use the shared helper implementation", async () => {
  assert.deepEqual(Object.keys(coreHelpers).sort(), Object.keys(helpers).sort());

  const [helpersSource, coreSource, sharedSource] = await Promise.all([
    readFile(new URL("../src/helpers.js", import.meta.url), "utf8"),
    readFile(new URL("../src/helpers/core.js", import.meta.url), "utf8"),
    readFile(new URL("../src/helpers/shared.js", import.meta.url), "utf8")
  ]);

  assert.match(helpersSource, /createHelperExports/);
  assert.match(coreSource, /createHelperExports/);
  assert.match(sharedSource, /function set\(/);
  assert.doesNotMatch(helpersSource, /function set\(/);
  assert.doesNotMatch(coreSource, /function set\(/);
});
