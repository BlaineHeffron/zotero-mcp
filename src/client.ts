import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { WorkbenchError } from "./errors.js";

export interface HttpResponse<T = unknown> {
  data: T;
  headers: Headers;
  status: number;
}

export interface ZoteroClientOptions {
  baseUrl?: string;
  tokenFile?: string;
  fetchImpl?: typeof fetch;
}

const INSTALL_HINT = "Install and enable the Research Workbench Zotero extension.";

export class ZoteroClient {
  readonly baseUrl: string;
  readonly tokenFile: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ZoteroClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.ZOTERO_MCP_BASE_URL ?? "http://127.0.0.1:23119").replace(/\/$/, "");
    const configured = options.tokenFile ?? process.env.ZOTERO_MCP_TOKEN_FILE ?? "~/.research-workbench/zotero-bridge.json";
    this.tokenFile = configured.startsWith("~/") ? resolve(homedir(), configured.slice(2)) : resolve(configured);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async read<T = unknown>(path: string, query: Record<string, string | number | undefined> = {}): Promise<HttpResponse<T>> {
    return this.request<T>("GET", path, query);
  }

  async write<T = unknown>(method: "POST", path: string, body: unknown): Promise<HttpResponse<T>> {
    const token = await this.loadToken(true);
    return this.request<T>(method, path, {}, body, token);
  }

  async health(): Promise<{ zoteroRunning: boolean; localApi: boolean; writeApi: boolean; writeAuth: boolean }> {
    let zoteroRunning = false;
    let localApi = false;
    let writeApi = false;
    let writeAuth = false;

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/`, {
        headers: { "Zotero-API-Version": "3" },
        signal: AbortSignal.timeout(2_000),
      });
      zoteroRunning = true;
      localApi = response.ok;
    } catch {
      return { zoteroRunning, localApi, writeApi, writeAuth };
    }

    const token = await this.loadToken(false);
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await this.fetchImpl(`${this.baseUrl}/research-workbench/v1/health`, {
        headers,
        signal: AbortSignal.timeout(2_000),
      });
      writeApi = response.ok;
      if (response.ok) {
        const body = await response.json() as { authenticated?: boolean };
        writeAuth = body.authenticated === true;
      }
    } catch {
      // Health is intentionally non-throwing.
    }
    return { zoteroRunning, localApi, writeApi, writeAuth };
  }

  private async loadToken(required: boolean): Promise<string | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.tokenFile, "utf8");
    } catch (error) {
      if (!required) return undefined;
      throw new WorkbenchError("auth_missing", `${INSTALL_HINT} Token file is missing or unreadable.`, {
        tokenFile: this.tokenFile,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      const parsed = JSON.parse(raw) as { token?: unknown };
      if (typeof parsed.token !== "string" || parsed.token.length === 0) throw new Error("token must be a non-empty string");
      return parsed.token;
    } catch (error) {
      if (!required) return undefined;
      throw new WorkbenchError("auth_missing", `${INSTALL_HINT} Token file does not contain a usable token.`, {
        tokenFile: this.tokenFile,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    query: Record<string, string | number | undefined> = {},
    body?: unknown,
    token?: string,
  ): Promise<HttpResponse<T>> {
    const url = new URL(path, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.append(key, String(value));
    }
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Zotero-API-Version": "3",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      const init: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(10_000),
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      response = await this.fetchImpl(url, init);
    } catch (error) {
      throw new WorkbenchError("upstream_unavailable", "Zotero is not reachable on 127.0.0.1:23119. Start Zotero and retry.", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) this.throwForStatus(response.status, path, data);
    return { data: data as T, headers: response.headers, status: response.status };
  }

  private throwForStatus(status: number, path: string, data: unknown): never {
    const detail = { status, body: data };
    const isWriteApi = path.startsWith("/research-workbench/");
    if (status === 401) throw new WorkbenchError("auth_invalid", "The Zotero extension rejected the bearer token. Regenerate or refresh the token file.", detail);
    if (status === 404 && isWriteApi) throw new WorkbenchError("upstream_unavailable", `${INSTALL_HINT} The write API route was not found.`, detail);
    if (status === 404) throw new WorkbenchError("not_found", "The requested Zotero object was not found.", detail);
    if (status === 409) throw new WorkbenchError("invalid_input", "The Zotero item version is stale; fetch the current item and retry.", detail);
    if (status === 400 || status === 413 || status === 422) throw new WorkbenchError("invalid_input", "Zotero rejected the request input.", detail);
    if (status === 405 || status === 501) throw new WorkbenchError("unsupported_capability", "This operation is not supported by the installed Zotero API.", detail);
    throw new WorkbenchError("upstream_error", `Zotero returned HTTP ${status}.`, detail);
  }
}
