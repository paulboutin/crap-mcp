#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repository } from "./files.ts";
import { publish, sync } from "./issues.ts";
import { github } from "./github.ts";

const [command, project, id] = process.argv.slice(2);
const repo = repository(process.cwd());

if (command === "publish" && project && id) {
  console.log(publish(repo, project, id, github));
  writeFileSync(join(repo.store, "github.autosync"), "enabled\n");
} else if (command === "sync")
  console.log(
    existsSync(join(repo.store, "github.sqlite")) ? sync(repo, github) : [],
  );
else throw Error("Usage: crap-issues publish OWNER/REPO FINDING_ID | sync");
