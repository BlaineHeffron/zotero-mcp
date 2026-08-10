import type { CallToolResult } from "@modelcontextprotocol/server";

export const ERROR_CODES = [
  "upstream_unavailable",
  "auth_missing",
  "auth_invalid",
  "unsupported_capability",
  "not_found",
  "invalid_input",
  "upstream_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class WorkbenchError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function errorResult(error: unknown): CallToolResult {
  const normalized = error instanceof WorkbenchError
    ? error
    : new WorkbenchError("upstream_error", "Unexpected adapter error.", {
        reason: error instanceof Error ? error.message : String(error),
      });
  const body = {
    code: normalized.code,
    message: normalized.message,
    detail: normalized.detail,
  };
  return {
    isError: true,
    structuredContent: body,
    content: [{ type: "text", text: JSON.stringify(body) }],
  };
}

export function okResult(value: Record<string, unknown>): CallToolResult {
  return {
    structuredContent: value,
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}
