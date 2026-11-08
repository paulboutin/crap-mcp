import { readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import {
  git,
  nul,
  maxSourceBytes,
  safeFile,
  workFiles,
  type Repo,
} from "./files.ts";

type Candidate = (repo: Repo, file: string) => boolean;

type Inspect = (file: string, read: () => string) => void;

function committed(
  repo: Repo,
  commit: string,
  candidate: Candidate,
  inspect: Inspect,
) {
  for (const entry of nul(
    git(repo.root, "ls-tree", "-r", "-l", "-z", commit),
  )) {
    const tab = entry.indexOf("\t"),
      file = entry.slice(tab + 1);

    if (!candidate(repo, file)) continue;
    const [mode, , oid, size] = entry.slice(0, tab).trim().split(/\s+/);
    inspect(file, () => {
      if (!["100644", "100755"].includes(mode) || Number(size) > maxSourceBytes)
        throw Error("Not a regular source blob within the 16 MiB limit");

      return git(repo.root, "cat-file", "blob", oid);
    });
  }
}

// File metadata on both sides catches ordinary edits, deletions and renames during a scan.
function workInputs(repo: Repo, candidate: Candidate) {
  return workFiles(repo).flatMap((file) => {
    if (!candidate(repo, file)) return [];

    const stat = lstatSync(join(repo.root, file), {
      bigint: true,
      throwIfNoEntry: false,
    });

    return stat
      ? [[file, String(stat.ino), String(stat.ctimeNs), String(stat.size)]]
      : [];
  });
}

function working(repo: Repo, candidate: Candidate, inspect: Inspect) {
  const inputs = workInputs(repo, candidate);

  for (const [file] of inputs)
    inspect(file, () => readFileSync(safeFile(repo.root, file), "utf8"));

  if (JSON.stringify(inputs) !== JSON.stringify(workInputs(repo, candidate)))
    throw Error("Application source changed during scan; retry");
}

export function visitSources(
  repo: Repo,
  commit: string | null,
  candidate: Candidate,
  inspect: Inspect,
) {
  if (commit) committed(repo, commit, candidate, inspect);
  else working(repo, candidate, inspect);
}
