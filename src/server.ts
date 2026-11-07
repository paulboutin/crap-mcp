#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { repository } from "./files.ts";
import { createServer } from "./service.ts";

const root = process.argv[2] ?? process.cwd();

await createServer(repository(root)).connect(new StdioServerTransport());
