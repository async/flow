import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as helpers from "../src/helpers.js";
import * as coreHelpers from "../src/helpers/core.js";

test("helpers and helpers/core keep export and source parity", async () => {
  assert.deepEqual(Object.keys(coreHelpers).sort(), Object.keys(helpers).sort());

  const [helpersSource, coreSource] = await Promise.all([
    readFile(new URL("../src/helpers.js", import.meta.url), "utf8"),
    readFile(new URL("../src/helpers/core.js", import.meta.url), "utf8")
  ]);

  assert.equal(normalizeHelperSource(coreSource), helpersSource);
});

function normalizeHelperSource(source) {
  return source
    .replaceAll("../define.js", "./define.js")
    .replaceAll("../framework-runtime.js", "./runtime.js")
    .replaceAll("../compose.js", "./compose.js")
    .replaceAll("../protocol.js", "./protocol.js");
}
