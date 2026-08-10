import type { CallToolResult, Tool } from "@modelcontextprotocol/server";
import { ZoteroClient } from "./client.js";
import { errorResult, okResult, WorkbenchError } from "./errors.js";

type JsonObject = Record<string, unknown>;

const objectSchema = (
  properties: Record<string, object>,
  required: string[] = [],
  additionalProperties = false,
): Tool["inputSchema"] => ({
  type: "object",
  properties,
  required,
  additionalProperties,
}) as Tool["inputSchema"];

const readAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const limit = { type: "integer", minimum: 1, maximum: 100, default: 25 };
const start = { type: "integer", minimum: 0, default: 0 };
const stringArray = { type: "array", items: { type: "string" } };

export const TOOLS: Tool[] = [
  {
    name: "zotero_search_items",
    title: "Search Zotero items",
    description: "Search the local Zotero library by title, creator, and year. Read-only.",
    inputSchema: objectSchema({ q: { type: "string", minLength: 1 }, itemType: { type: "string" }, tag: { type: "string" }, limit, start }, ["q"]),
    annotations: readAnnotations,
  },
  {
    name: "zotero_get_item",
    title: "Get Zotero item",
    description: "Get one Zotero item and optionally its children or indexed full text. Read-only.",
    inputSchema: objectSchema({ key: { type: "string", minLength: 1 }, include: { type: "array", uniqueItems: true, items: { type: "string", enum: ["children", "fulltext"] } } }, ["key"]),
    annotations: readAnnotations,
  },
  {
    name: "zotero_list_collections",
    title: "List Zotero collections",
    description: "List local Zotero collections. Read-only.",
    inputSchema: objectSchema({ limit, start }),
    annotations: readAnnotations,
  },
  {
    name: "zotero_get_collection_items",
    title: "Get Zotero collection items",
    description: "List top-level items in a Zotero collection. Read-only.",
    inputSchema: objectSchema({ collectionKey: { type: "string", minLength: 1 }, limit, start }, ["collectionKey"]),
    annotations: readAnnotations,
  },
  {
    name: "zotero_list_tags",
    title: "List Zotero tags",
    description: "List tags from the local Zotero library. Read-only.",
    inputSchema: objectSchema({ q: { type: "string" }, limit }),
    annotations: readAnnotations,
  },
  {
    name: "zotero_get_item_notes",
    title: "Get Zotero item notes",
    description: "List note children for a Zotero item. Read-only.",
    inputSchema: objectSchema({ key: { type: "string", minLength: 1 } }, ["key"]),
    annotations: readAnnotations,
  },
  {
    name: "zotero_create_item",
    title: "Create Zotero item",
    description: "Create a Zotero item through the authenticated Research Workbench extension.",
    inputSchema: objectSchema({ itemType: { type: "string", minLength: 1 }, fields: { type: "object" }, creators: { type: "array", items: { type: "object" } }, collectionKeys: stringArray, tags: stringArray }, ["itemType", "fields"]),
    annotations: writeAnnotations,
  },
  {
    name: "zotero_update_item",
    title: "Update Zotero item",
    description: "Update Zotero fields with optimistic version checking through the authenticated extension.",
    inputSchema: objectSchema({ key: { type: "string", minLength: 1 }, version: { type: "integer", minimum: 0 }, fields: { type: "object" } }, ["key", "version", "fields"]),
    annotations: writeAnnotations,
  },
  {
    name: "zotero_create_note",
    title: "Create Zotero note",
    description: "Create a standalone or child HTML note through the authenticated extension.",
    inputSchema: objectSchema({ parentKey: { type: "string" }, html: { type: "string" }, tags: stringArray }, ["html"]),
    annotations: writeAnnotations,
  },
  {
    name: "zotero_add_tags",
    title: "Add Zotero tags",
    description: "Add tags to a Zotero item through the authenticated extension.",
    inputSchema: objectSchema({ key: { type: "string", minLength: 1 }, tags: { ...stringArray, minItems: 1 } }, ["key", "tags"]),
    annotations: writeAnnotations,
  },
  {
    name: "zotero_create_collection",
    title: "Create Zotero collection",
    description: "Create a Zotero collection through the authenticated extension.",
    inputSchema: objectSchema({ name: { type: "string", minLength: 1 }, parentKey: { type: "string" } }, ["name"]),
    annotations: writeAnnotations,
  },
  {
    name: "zotero_add_to_collection",
    title: "Add items to Zotero collection",
    description: "Add existing items to a Zotero collection through the authenticated extension.",
    inputSchema: objectSchema({ collectionKey: { type: "string", minLength: 1 }, itemKeys: { ...stringArray, minItems: 1 } }, ["collectionKey", "itemKeys"]),
    annotations: writeAnnotations,
  },
  {
    name: "zotero_attach_link",
    title: "Attach Zotero link",
    description: "Create a linked-URL attachment. File-content uploads are not supported in v1.",
    inputSchema: objectSchema({ parentKey: { type: "string", minLength: 1 }, url: { type: "string", format: "uri" }, title: { type: "string" } }, ["parentKey", "url"]),
    annotations: writeAnnotations,
  },
  {
    name: "zotero_trash_item",
    title: "Move Zotero item to trash",
    description: "Move an item to Zotero trash. This never permanently deletes it.",
    inputSchema: objectSchema({ key: { type: "string", minLength: 1 } }, ["key"]),
    annotations: writeAnnotations,
  },
  {
    name: "zotero_health",
    title: "Check Zotero adapter health",
    description: "Check Zotero, its local read API, the Research Workbench write API, and bearer authentication. Never errors.",
    inputSchema: objectSchema({}),
    annotations: readAnnotations,
  },
];

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkbenchError("invalid_input", "Tool arguments must be a JSON object.");
  return value as JsonObject;
}

function text(args: JsonObject, key: string, required = true): string | undefined {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || (required && value.length === 0)) throw new WorkbenchError("invalid_input", `${key} must be a${required ? " non-empty" : ""} string.`);
  return value;
}

function integer(args: JsonObject, key: string, fallback?: number): number | undefined {
  const value = args[key] ?? fallback;
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) throw new WorkbenchError("invalid_input", `${key} must be an integer.`);
  return value as number;
}

function normalizedItem(value: unknown): Record<string, unknown> {
  const item = object(value);
  const data = object(item.data ?? item);
  return {
    key: item.key ?? data.key,
    version: item.version ?? data.version,
    itemType: data.itemType,
    title: data.title ?? "",
    creators: data.creators ?? [],
    date: data.date ?? "",
    ...(data.DOI ? { DOI: data.DOI } : {}),
    ...(data.url ? { url: data.url } : {}),
    tags: data.tags ?? [],
    collections: data.collections ?? [],
  };
}

function page(response: { data: unknown; headers: Headers }, key: string, mapper = (value: unknown) => value): Record<string, unknown> {
  const values = Array.isArray(response.data) ? response.data.map(mapper) : [];
  const totalHeader = response.headers.get("Total-Results");
  return { [key]: values, ...(totalHeader && Number.isFinite(Number(totalHeader)) ? { total: Number(totalHeader) } : {}) };
}

export class ZoteroTools {
  constructor(readonly client: ZoteroClient) {}

  async call(name: string, rawArgs: unknown): Promise<CallToolResult> {
    try {
      const args = object(rawArgs ?? {});
      switch (name) {
        case "zotero_search_items": {
          const response = await this.client.read("/api/users/0/items", {
            q: text(args, "q"),
            qmode: "titleCreatorYear",
            itemType: text(args, "itemType", false),
            tag: text(args, "tag", false),
            limit: integer(args, "limit", 25),
            start: integer(args, "start", 0),
          });
          return okResult(page(response, "items", normalizedItem));
        }
        case "zotero_get_item": {
          const key = text(args, "key") as string;
          const item = (await this.client.read(`/api/users/0/items/${encodeURIComponent(key)}`)).data;
          const result: JsonObject = { item: normalizedItem(item) };
          const include = args.include;
          if (include !== undefined && (!Array.isArray(include) || include.some((value) => value !== "children" && value !== "fulltext"))) {
            throw new WorkbenchError("invalid_input", "include must contain only children or fulltext.");
          }
          if (Array.isArray(include) && include.includes("children")) {
            result.children = (await this.client.read(`/api/users/0/items/${encodeURIComponent(key)}/children`)).data;
          }
          if (Array.isArray(include) && include.includes("fulltext")) {
            try {
              result.fulltext = (await this.client.read(`/api/users/0/items/${encodeURIComponent(key)}/fulltext`)).data;
            } catch (error) {
              if (error instanceof WorkbenchError && error.code === "not_found") {
                throw new WorkbenchError("unsupported_capability", "The installed Zotero local API does not expose item full text; use item metadata or attachments instead.", error.detail);
              }
              throw error;
            }
          }
          return okResult(result);
        }
        case "zotero_list_collections": {
          const response = await this.client.read("/api/users/0/collections", { limit: integer(args, "limit", 25), start: integer(args, "start", 0) });
          return okResult(page(response, "collections"));
        }
        case "zotero_get_collection_items": {
          const collectionKey = text(args, "collectionKey") as string;
          const response = await this.client.read(`/api/users/0/collections/${encodeURIComponent(collectionKey)}/items/top`, { limit: integer(args, "limit", 25), start: integer(args, "start", 0) });
          return okResult(page(response, "items", normalizedItem));
        }
        case "zotero_list_tags": {
          const response = await this.client.read("/api/users/0/tags", { q: text(args, "q", false), limit: integer(args, "limit", 25) });
          return okResult(page(response, "tags"));
        }
        case "zotero_get_item_notes": {
          const key = text(args, "key") as string;
          const response = await this.client.read(`/api/users/0/items/${encodeURIComponent(key)}/children`);
          const children = Array.isArray(response.data) ? response.data : [];
          return okResult({ notes: children.filter((value) => {
            const entry = object(value);
            const data = object(entry.data ?? entry);
            return data.itemType === "note";
          }) });
        }
        case "zotero_create_item":
          return okResult(object((await this.client.write("POST", "/research-workbench/v1/items", args)).data));
        case "zotero_update_item": {
          const key = text(args, "key") as string;
          const { key: _key, ...body } = args;
          return okResult(object((await this.client.write("POST", `/research-workbench/v1/items/${encodeURIComponent(key)}/update`, body)).data));
        }
        case "zotero_create_note":
          return okResult(object((await this.client.write("POST", "/research-workbench/v1/notes", args)).data));
        case "zotero_add_tags": {
          const key = text(args, "key") as string;
          return okResult(object((await this.client.write("POST", `/research-workbench/v1/items/${encodeURIComponent(key)}/tags`, { tags: args.tags })).data));
        }
        case "zotero_create_collection":
          return okResult(object((await this.client.write("POST", "/research-workbench/v1/collections", args)).data));
        case "zotero_add_to_collection": {
          const key = text(args, "collectionKey") as string;
          return okResult(object((await this.client.write("POST", `/research-workbench/v1/collections/${encodeURIComponent(key)}/items`, { itemKeys: args.itemKeys })).data));
        }
        case "zotero_attach_link":
          return okResult(object((await this.client.write("POST", "/research-workbench/v1/attachments/link", args)).data));
        case "zotero_trash_item": {
          const key = text(args, "key") as string;
          return okResult(object((await this.client.write("POST", `/research-workbench/v1/items/${encodeURIComponent(key)}/trash`, {})).data));
        }
        case "zotero_health":
          return okResult(await this.client.health());
        default:
          throw new WorkbenchError("unsupported_capability", `Tool ${name} is not part of the Research Workbench Zotero contract.`);
      }
    } catch (error) {
      return errorResult(error);
    }
  }
}
