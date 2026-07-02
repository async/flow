#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = new URL("..", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const checks = [];

function collect(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      collect(path);
    } else if (path.endsWith(".js")) {
      checks.push(path);
    }
  }
}

collect(join(root, "src"));
collect(join(root, "tests"));

for (const file of checks) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
}

const tsc = require.resolve("typescript/bin/tsc");
const types = spawnSync(process.execPath, [tsc, "-p", "tests/tsconfig.consumer.json"], {
  cwd: root,
  encoding: "utf8"
});

if (types.status !== 0) {
  process.stderr.write(types.stderr || types.stdout);
  process.exit(types.status ?? 1);
}

console.log(`checked ${checks.length} JavaScript files and strict TypeScript consumer declarations`);
