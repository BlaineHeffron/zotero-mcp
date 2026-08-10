#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";

if (process.argv.includes("--version")) {
  process.stdout.write("zotero-mcp 0.1.0\n");
} else {
  serveStdio(() => createServer());
}
