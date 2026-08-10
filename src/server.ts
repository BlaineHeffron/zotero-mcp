import { Server } from "@modelcontextprotocol/server";
import { ZoteroClient, type ZoteroClientOptions } from "./client.js";
import { TOOLS, ZoteroTools } from "./tools.js";

export function createServer(options: ZoteroClientOptions = {}): Server {
  const tools = new ZoteroTools(new ZoteroClient(options));
  const server = new Server(
    { name: "research-workbench-zotero", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: "Zotero is canonical for bibliography and documents. Reads use Zotero's GET-only local API; writes require the Research Workbench extension. Never claim a write succeeded when a tool returns an error. Permanent deletion and file-content upload are unsupported; trash and linked-URL attachments are the supported alternatives.",
      cacheHints: {
        "server/discover": { ttlMs: 300_000, cacheScope: "public" },
        "tools/list": { ttlMs: 300_000, cacheScope: "public" },
      },
    },
  );
  server.setRequestHandler("tools/list", async () => ({ tools: TOOLS }));
  server.setRequestHandler("tools/call", async (request) => tools.call(request.params.name, request.params.arguments ?? {}));
  return server;
}
