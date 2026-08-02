import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, before, describe, it } from "node:test";

import { ZoteroClient } from "../src/client.js";
import { TOOLS, ZoteroTools } from "../src/tools.js";

type Handler = (request: IncomingMessage, response: ServerResponse, body: unknown) => void;

let fixture: Record<string, unknown>;
const openServers: ReturnType<typeof createHttpServer>[] = [];

before(async () => {
  fixture = JSON.parse(await readFile(new URL("./fixtures/local-api.json", import.meta.url), "utf8"));
});

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function mockServer(handler: Handler): Promise<string> {
  const server = createHttpServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    handler(request, response, raw ? JSON.parse(raw) : null);
  });
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function parse(result: Awaited<ReturnType<ZoteroTools["call"]>>): Record<string, unknown> {
  return JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}") as Record<string, unknown>;
}

describe("tool contract", () => {
  it("lists exactly the 15 contracted tools with schemas", () => {
    assert.equal(TOOLS.length, 15);
    assert.deepEqual(TOOLS.map((tool) => tool.name), [
      "zotero_search_items", "zotero_get_item", "zotero_list_collections", "zotero_get_collection_items",
      "zotero_list_tags", "zotero_get_item_notes", "zotero_create_item", "zotero_update_item",
      "zotero_create_note", "zotero_add_tags", "zotero_create_collection", "zotero_add_to_collection",
      "zotero_attach_link", "zotero_trash_item", "zotero_health",
    ]);
    assert(TOOLS.every((tool) => tool.inputSchema.type === "object"));
  });

  it("maps local API fixtures into stable search output", async () => {
    const baseUrl = await mockServer((request, response) => {
      assert.equal(request.method, "GET");
      assert.match(request.url ?? "", /^\/api\/users\/0\/items\?/);
      json(response, 200, fixture.items, { "Total-Results": "1" });
    });
    const tools = new ZoteroTools(new ZoteroClient({ baseUrl, tokenFile: "/does/not/exist" }));
    const result = await tools.call("zotero_search_items", { q: "phonon" });
    assert.equal(result.isError, undefined);
    const body = parse(result);
    assert.equal(body.total, 1);
    assert.equal((body.items as Array<Record<string, unknown>>)[0]?.key, "PHONON01");
  });

  it("filters child notes", async () => {
    const baseUrl = await mockServer((_request, response) => json(response, 200, fixture.children));
    const tools = new ZoteroTools(new ZoteroClient({ baseUrl }));
    const result = await tools.call("zotero_get_item_notes", { key: "PHONON01" });
    assert.equal((parse(result).notes as unknown[]).length, 1);
  });

  it("returns unsupported_capability when local fulltext is absent", async () => {
    const baseUrl = await mockServer((request, response) => {
      if (request.url?.endsWith("/fulltext")) return json(response, 404, { error: "not found" });
      json(response, 200, (fixture.items as unknown[])[0]);
    });
    const tools = new ZoteroTools(new ZoteroClient({ baseUrl }));
    const result = await tools.call("zotero_get_item", { key: "PHONON01", include: ["fulltext"] });
    assert.equal(result.isError, true);
    assert.equal(parse(result).code, "unsupported_capability");
  });
});

describe("mandatory failure modes", () => {
  it("Zotero down returns upstream_unavailable", async () => {
    const tools = new ZoteroTools(new ZoteroClient({ baseUrl: "http://127.0.0.1:1" }));
    const result = await tools.call("zotero_search_items", { q: "phonon" });
    assert.equal(result.isError, true);
    assert.equal(parse(result).code, "upstream_unavailable");
  });

  it("missing token returns auth_missing before a write", async () => {
    const baseUrl = await mockServer((_request, response) => json(response, 500, {}));
    const tools = new ZoteroTools(new ZoteroClient({ baseUrl, tokenFile: "/definitely/missing/token.json" }));
    const result = await tools.call("zotero_create_note", { html: "<p>test</p>" });
    assert.equal(result.isError, true);
    assert.equal(parse(result).code, "auth_missing");
  });

  it("extension absent returns upstream_unavailable with install hint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zotero-mcp-"));
    const tokenFile = join(dir, "token.json");
    await writeFile(tokenFile, JSON.stringify({ token: "dummy-test-token" }), { mode: 0o600 });
    const baseUrl = await mockServer((_request, response) => json(response, 404, { error: "not found" }));
    const tools = new ZoteroTools(new ZoteroClient({ baseUrl, tokenFile }));
    const result = await tools.call("zotero_create_note", { html: "<p>test</p>" });
    assert.equal(result.isError, true);
    const body = parse(result);
    assert.equal(body.code, "upstream_unavailable");
    assert.match(String(body.message), /install.*extension/i);
  });

  it("stale version returns invalid_input with upstream detail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zotero-mcp-"));
    const tokenFile = join(dir, "token.json");
    await writeFile(tokenFile, JSON.stringify({ token: "dummy-test-token" }), { mode: 0o600 });
    const baseUrl = await mockServer((request, response) => {
      assert.equal(request.headers.authorization, "Bearer dummy-test-token");
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/research-workbench/v1/items/PHONON01/update");
      json(response, 409, { error: { code: "invalid_input", currentVersion: 8 } });
    });
    const tools = new ZoteroTools(new ZoteroClient({ baseUrl, tokenFile }));
    const result = await tools.call("zotero_update_item", { key: "PHONON01", version: 7, fields: { title: "New" } });
    assert.equal(result.isError, true);
    const body = parse(result);
    assert.equal(body.code, "invalid_input");
    assert.equal(((body.detail as Record<string, unknown>).body as Record<string, unknown>).error instanceof Object, true);
  });
});

describe("upstream URL security", () => {
  it("rejects remote hosts, non-HTTP schemes, and userinfo", () => {
    for (const baseUrl of [
      "http://example.com:23119",
      "http://127.0.0.1.example:23119",
      "http://[::2]:23119",
      "https://127.0.0.1:23119",
      "http://user:secret@127.0.0.1:23119",
    ]) {
      assert.throws(() => new ZoteroClient({ baseUrl }), /plain HTTP.*exact loopback hostname.*no userinfo/i);
    }
  });

  it("does not follow a redirect or forward the write bearer", async () => {
    let sinkRequests = 0;
    const sinkUrl = await mockServer((request, response) => {
      sinkRequests++;
      assert.equal(request.headers.authorization, undefined);
      json(response, 200, { leaked: true });
    });
    const redirectUrl = await mockServer((request, response) => {
      assert.equal(request.headers.authorization, "Bearer dummy-test-token");
      response.writeHead(307, { Location: `${sinkUrl}/leak` });
      response.end();
    });
    const dir = await mkdtemp(join(tmpdir(), "zotero-mcp-"));
    const tokenFile = join(dir, "token.json");
    await writeFile(tokenFile, JSON.stringify({ token: "dummy-test-token" }), { mode: 0o600 });

    const result = await new ZoteroTools(new ZoteroClient({ baseUrl: redirectUrl, tokenFile }))
      .call("zotero_create_note", { html: "<p>test</p>" });

    assert.equal(result.isError, true);
    assert.equal(sinkRequests, 0);
  });
});

describe("health", () => {
  it("never errors and verifies an authenticated extension health response", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zotero-mcp-"));
    const tokenFile = join(dir, "token.json");
    await writeFile(tokenFile, JSON.stringify({ token: "dummy-test-token" }), { mode: 0o600 });
    const baseUrl = await mockServer((request, response) => {
      if (request.url === "/api/") return json(response, 200, { version: 3 });
      assert.equal(request.headers.authorization, "Bearer dummy-test-token");
      json(response, 200, { ok: true, writeApi: true, authenticated: true });
    });
    const tools = new ZoteroTools(new ZoteroClient({ baseUrl, tokenFile }));
    const result = await tools.call("zotero_health", {});
    assert.equal(result.isError, undefined);
    assert.deepEqual(parse(result), { zoteroRunning: true, localApi: true, writeApi: true, writeAuth: true });
  });
});
