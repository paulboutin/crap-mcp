import { mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

mkdirSync("coverage", { recursive: true });

const file = "coverage/lcov.info",
  tests = readdirSync("test")
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => "test/" + f);

const child = spawnSync(
  process.execPath,
  [
    "--experimental-test-coverage",
    "--test-coverage-include=src/**/*.ts",
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    "--test-reporter-destination=" + file,
    "--test",
    ...tests,
  ],
  { stdio: "inherit" },
);

process.exitCode = child.status ?? 1;
