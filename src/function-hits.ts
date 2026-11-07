// Legacy LCOV FN/FNDA records carry a start line and a function name.
// A duplicated source record, name, or start line cannot uniquely identify a callback.
import { relative, resolve } from "node:path";
import type { Counts } from "./importers.ts";

function occurrences(keys: Iterable<string>) {
  const counts = new Map<string, number>();

  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);

  return counts;
}

function counters(block: string): Counts {
  const definitions = [
    ...block.matchAll(/^FN:(\d+),(?:(\d+),)?([^\r\n]+)\r?$/gm),
  ];

  const executions = [...block.matchAll(/^FNDA:(\d+),([^\r\n]+)\r?$/gm)];

  const names = occurrences(definitions.map((m) => m[3])),
    starts = occurrences(definitions.map((m) => m[1]));

  const hitNames = occurrences(executions.map((m) => m[2]));
  const hits = new Map(executions.map((m) => [m[2], Number(m[1])]));
  const result: Counts = [];

  for (const [, line, end, name] of definitions) {
    if (end && end !== line) continue;

    if (
      names.get(name) !== 1 ||
      starts.get(line) !== 1 ||
      hitNames.get(name) !== 1
    )
      continue;
    result.push([Number(line), hits.get(name)!]);
  }

  return result;
}

export function functionHits(root: string, text: string) {
  const result = new Map<string, Counts>();

  for (const block of text.split(/^end_of_record\r?$/m)) {
    const paths = [...block.matchAll(/^SF:([^\r\n]+)\r?$/gm)];

    if (paths.length !== 1) continue;

    const path = relative(root, resolve(root, paths[0][1]))
      .split("\\")
      .join("/");

    result.set(path, result.has(path) ? [] : counters(block));
  }

  return Object.fromEntries(result);
}
