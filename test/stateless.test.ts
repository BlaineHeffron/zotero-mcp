import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";

const modernMeta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "stateless-test", version: "1.0.0" },
};

async function request(message: Record<string, unknown>): Promise<Record<string, any>> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const response = new Promise<Record<string, any>>((resolve, reject) => {
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      try {
        resolve(JSON.parse(buffer.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code && code !== 0) reject(new Error(`server exited with ${code}`));
    });
  });
  child.stdin.end(`${JSON.stringify(message)}\n`);
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      response,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("MCP response timeout")), 5_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    child.kill();
  }
}

describe("stateless protocol lifecycle", () => {
  it("serves 2026-07-28 discovery without initialize or a session", async () => {
    const response = await request({
      jsonrpc: "2.0",
      id: "discover",
      method: "server/discover",
      params: { _meta: modernMeta },
    });
    assert.deepEqual(response.result.supportedVersions, ["2026-07-28"]);
    assert.equal(response.result.resultType, "complete");
    assert.equal(response.result.ttlMs, 300_000);
    assert.equal(response.result.cacheScope, "public");
    assert.equal(response.result._meta["io.modelcontextprotocol/serverInfo"].name, "research-workbench-zotero");
  });
});
