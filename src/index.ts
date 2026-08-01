#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";

if (process.argv.includes("--version")) {
  process.stdout.write("zotero-mcp 0.1.0\n");
} else {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
