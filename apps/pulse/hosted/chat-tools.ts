import {
  membershipCan,
  roleCan,
  type StandalonePermission,
  type StandaloneRole,
} from "./rbac.js";

const TOOL_TAG_NAMES = [
  "SAVE_KNOWLEDGE",
  "UPDATE_NOTE",
  "MERGE_NOTES",
  "DELETE_NOTE",
  "UPDATE_SETTING",
  "ADD_TOPIC",
  "SET_AUTOPILOT",
  "SET_MODEL",
  "READY_TO_CONFIGURE",
  "EXPORT_PROFILE",
  "GENERATE_IMAGE",
  "LIST_IMAGES",
] as const;

const TOOL_TAG_PATTERN = new RegExp(
  `\\[(${TOOL_TAG_NAMES.join("|")})(:\\s*[\\s\\S]*?)?\\]`,
  "g",
);
const TYPED_TOOL_BLOCK_PATTERN = /```pulse-tools\s*([\s\S]*?)```/g;

export const ALLOWED_UPDATE_SETTING_PATHS = [
  "account.contentModel",
  "autoFollow.dailyCap",
  "autoFollow.enabled",
  "autopilot.mode",
  "autopilot.postsPerDay",
  "autopilot.tone",
  "persona.brandName",
  "persona.neverSay",
  "persona.niche",
  "persona.tone",
  "persona.website",
  "persona.xHandle",
] as const;

export type AllowedUpdateSettingPath =
  (typeof ALLOWED_UPDATE_SETTING_PATHS)[number];

type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface SaveKnowledgePayload {
  title: string;
  content: string;
  priority?: number;
  tags?: string[];
}

export interface UpdateNotePayload {
  title: string;
  content?: string;
  priority?: number;
}

export interface MergeNotesPayload {
  titles: string[];
  newTitle: string;
  newContent: string;
  priority?: number;
}

export interface UpdateSettingPayload {
  path: AllowedUpdateSettingPath;
  value: JsonValue;
}

export interface AddTopicPayload {
  query: string;
  replies?: string[];
}

export interface GenerateImagePayload {
  prompt: string;
  tags?: string[];
}

export type ToolAction =
  | { type: "save_knowledge"; payload: SaveKnowledgePayload; raw: string }
  | { type: "update_note"; payload: UpdateNotePayload; raw: string }
  | { type: "merge_notes"; payload: MergeNotesPayload; raw: string }
  | { type: "delete_note"; payload: string; raw: string }
  | { type: "update_setting"; payload: UpdateSettingPayload; raw: string }
  | { type: "add_topic"; payload: AddTopicPayload; raw: string }
  | { type: "set_autopilot"; payload: string; raw: string }
  | { type: "set_model"; payload: string; raw: string }
  | { type: "generate_image"; payload: GenerateImagePayload; raw: string }
  | { type: "list_images"; payload: null; raw: string }
  | { type: "ready_to_configure"; payload: null; raw: string }
  | { type: "export_profile"; payload: null; raw: string };

export interface RejectedToolAction {
  tag: string;
  raw: string;
  reason: "invalid_json" | "invalid_payload" | "invalid_setting_path";
  details?: string;
}

export interface ToolActionDryRun {
  actions: ToolAction[];
  rejected: RejectedToolAction[];
}

export type ChatToolImpact =
  | "read"
  | "content"
  | "configuration"
  | "automation";

export interface ChatToolPolicyContext {
  membership?: { role: StandaloneRole } | null;
  role?: StandaloneRole;
}

export interface ChatToolPolicyEvaluation {
  allowed: boolean;
  mutating: boolean;
  permission: StandalonePermission | null;
  impact: ChatToolImpact;
  reason?: string;
  targetType: string;
  targetId?: string;
}

type ChatToolAuditTargetType =
  | ToolAction["type"]
  | "setting"
  | "topic"
  | "knowledge_note"
  | "image_request";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAllowedUpdateSettingPath(
  path: string,
): path is AllowedUpdateSettingPath {
  if (!/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/.test(path))
    return false;
  return (ALLOWED_UPDATE_SETTING_PATHS as readonly string[]).includes(path);
}

export function validateUpdateSettingPath(
  path: unknown,
):
  | { ok: true; path: AllowedUpdateSettingPath }
  | { ok: false; reason: string } {
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, reason: "path must be a non-empty string" };
  }
  if (!/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/.test(path)) {
    return { ok: false, reason: "path must use dotted identifiers only" };
  }
  if (!isAllowedUpdateSettingPath(path)) {
    return {
      ok: false,
      reason: "path is not in the allowed UPDATE_SETTING whitelist",
    };
  }
  return { ok: true, path };
}

function getUpdateSettingPermission(
  path: AllowedUpdateSettingPath,
): StandalonePermission {
  if (path.startsWith("autopilot.") || path.startsWith("autoFollow.")) {
    return "automation:configure";
  }
  return "brand:manage";
}

function policyPermissionAllows(
  context: ChatToolPolicyContext,
  permission: StandalonePermission,
): boolean {
  if (context.membership) return membershipCan(context.membership, permission);
  if (context.role) return roleCan(context.role, permission);
  return false;
}

export function evaluateToolActionPolicy(
  action: ToolAction,
  context?: ChatToolPolicyContext,
): ChatToolPolicyEvaluation {
  let permission: StandalonePermission | null = null;
  let impact: ChatToolImpact = "read";
  let targetType: ChatToolAuditTargetType = action.type;
  let targetId: string | undefined;

  switch (action.type) {
    case "update_setting":
      permission = getUpdateSettingPermission(action.payload.path);
      impact =
        permission === "automation:configure" ? "automation" : "configuration";
      targetType = "setting";
      targetId = action.payload.path;
      break;
    case "set_autopilot":
      permission = "automation:configure";
      impact = "automation";
      targetType = "setting";
      targetId = "autopilot.mode";
      break;
    case "set_model":
      permission = "brand:manage";
      impact = "configuration";
      targetType = "setting";
      targetId = "account.contentModel";
      break;
    case "add_topic":
      permission = "brand:manage";
      impact = "configuration";
      targetType = "topic";
      targetId = action.payload.query;
      break;
    case "save_knowledge":
      permission = "draft:create";
      impact = "content";
      targetType = "knowledge_note";
      targetId = action.payload.title;
      break;
    case "update_note":
      permission = "draft:create";
      impact = "content";
      targetType = "knowledge_note";
      targetId = action.payload.title;
      break;
    case "merge_notes":
      permission = "draft:create";
      impact = "content";
      targetType = "knowledge_note";
      targetId = action.payload.newTitle;
      break;
    case "delete_note":
      permission = "draft:create";
      impact = "content";
      targetType = "knowledge_note";
      targetId = action.payload;
      break;
    case "generate_image":
      permission = "draft:create";
      impact = "content";
      targetType = "image_request";
      targetId = action.payload.prompt;
      break;
    case "list_images":
    case "ready_to_configure":
    case "export_profile":
      break;
  }

  const mutating = permission !== null;
  if (!mutating) {
    return {
      allowed: true,
      mutating,
      permission,
      impact,
      targetType,
      targetId,
    };
  }
  if (!context) {
    return {
      allowed: true,
      mutating,
      permission,
      impact,
      targetType,
      targetId,
    };
  }
  const requiredPermission = permission as StandalonePermission;
  const allowed = policyPermissionAllows(context, requiredPermission);
  return {
    allowed,
    mutating,
    permission: requiredPermission,
    impact,
    reason: allowed ? undefined : `requires ${requiredPermission}`,
    targetType,
    targetId,
  };
}

function parseJsonTag(
  reply: string,
  tag: string,
  build: (
    payload: unknown,
    raw: string,
  ) => ToolAction | RejectedToolAction | null,
): Array<ToolAction | RejectedToolAction> {
  const results: Array<ToolAction | RejectedToolAction> = [];
  const prefix = `[${tag}:`;
  let searchFrom = 0;

  while (searchFrom < reply.length) {
    const tagStart = reply.indexOf(prefix, searchFrom);
    if (tagStart === -1) break;
    const jsonStart = reply.indexOf("{", tagStart + prefix.length);
    if (jsonStart === -1) {
      searchFrom = tagStart + prefix.length;
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let jsonEnd = -1;
    for (let index = jsonStart; index < reply.length; index += 1) {
      const char = reply[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          jsonEnd = index;
          break;
        }
      }
    }

    if (jsonEnd === -1) {
      searchFrom = jsonStart + 1;
      continue;
    }

    let closingBracket = jsonEnd + 1;
    while (/\s/.test(reply[closingBracket] || ""))
      closingBracket += 1;
    if (reply[closingBracket] !== "]") {
      searchFrom = jsonEnd + 1;
      continue;
    }

    const raw = reply.slice(tagStart, closingBracket + 1);
    const json = reply.slice(jsonStart, jsonEnd + 1);
    try {
      const payload = JSON.parse(json) as unknown;
      const result = build(payload, raw);
      if (result) results.push(result);
    } catch {
      results.push({ tag, raw, reason: "invalid_json" });
    }

    searchFrom = closingBracket + 1;
  }

  return results;
}

function buildTypedToolAction(
  call: unknown,
  raw: string,
): ToolAction | RejectedToolAction | null {
  if (!isRecord(call) || typeof call.type !== "string") {
    return { tag: "PULSE_TOOL_CALL", raw, reason: "invalid_payload" };
  }
  const payload = "payload" in call ? call.payload : null;

  switch (call.type) {
    case "save_knowledge":
      if (
        !isRecord(payload) ||
        typeof payload.title !== "string" ||
        typeof payload.content !== "string"
      ) {
        return { tag: "PULSE_TOOL_CALL", raw, reason: "invalid_payload" };
      }
      return {
        type: "save_knowledge",
        payload: {
          title: payload.title,
          content: payload.content,
          priority:
            typeof payload.priority === "number" ? payload.priority : undefined,
          tags:
            Array.isArray(payload.tags) &&
            payload.tags.every((tag) => typeof tag === "string")
              ? payload.tags
              : undefined,
        },
        raw,
      };
    case "update_note":
      if (!isRecord(payload) || typeof payload.title !== "string") {
        return { tag: "PULSE_TOOL_CALL", raw, reason: "invalid_payload" };
      }
      return {
        type: "update_note",
        payload: {
          title: payload.title,
          content:
            typeof payload.content === "string" ? payload.content : undefined,
          priority:
            typeof payload.priority === "number" ? payload.priority : undefined,
        },
        raw,
      };
    case "merge_notes":
      if (
        !isRecord(payload) ||
        !Array.isArray(payload.titles) ||
        !payload.titles.every((title) => typeof title === "string") ||
        typeof payload.newTitle !== "string" ||
        typeof payload.newContent !== "string"
      ) {
        return { tag: "PULSE_TOOL_CALL", raw, reason: "invalid_payload" };
      }
      return {
        type: "merge_notes",
        payload: {
          titles: payload.titles,
          newTitle: payload.newTitle,
          newContent: payload.newContent,
          priority:
            typeof payload.priority === "number" ? payload.priority : undefined,
        },
        raw,
      };
    case "delete_note":
      if (typeof payload !== "string") {
        return { tag: "PULSE_TOOL_CALL", raw, reason: "invalid_payload" };
      }
      return { type: "delete_note", payload, raw };
    case "update_setting": {
      if (!isRecord(payload) || !("path" in payload) || !("value" in payload)) {
        return { tag: "PULSE_TOOL_CALL", raw, reason: "invalid_payload" };
      }
      const validatedPath = validateUpdateSettingPath(payload.path);
      if (!validatedPath.ok) {
        return {
          tag: "PULSE_TOOL_CALL",
          raw,
          reason: "invalid_setting_path",
          details: validatedPath.reason,
        };
      }
      return {
        type: "update_setting",
        payload: {
          path: validatedPath.path,
          value: payload.value as JsonValue,
        },
        raw,
      };
    }
    case "add_topic":
      if (!isRecord(payload) || typeof payload.query !== "string") {
        return { tag: "PULSE_TOOL_CALL", raw, reason: "invalid_payload" };
      }
      return {
        type: "add_topic",
        payload: {
          query: payload.query,
          replies:
            Array.isArray(payload.replies) &&
            payload.replies.every((replyItem) => typeof replyItem === "string")
              ? payload.replies
              : undefined,
        },
        raw,
      };
    case "set_autopilot":
      if (typeof payload !== "string") {
        return { tag: "PULSE_TOOL_CALL", raw, reason: "invalid_payload" };
      }
      return { type: "set_autopilot", payload, raw };
    case "set_model":
      if (typeof payload !== "string") {
        return { tag: "PULSE_TOOL_CALL", raw, reason: "invalid_payload" };
      }
      return { type: "set_model", payload, raw };
    case "generate_image":
      if (!isRecord(payload) || typeof payload.prompt !== "string") {
        return { tag: "PULSE_TOOL_CALL", raw, reason: "invalid_payload" };
      }
      return {
        type: "generate_image",
        payload: {
          prompt: payload.prompt,
          tags:
            Array.isArray(payload.tags) &&
            payload.tags.every((tag) => typeof tag === "string")
              ? payload.tags
              : undefined,
        },
        raw,
      };
    case "list_images":
      return { type: "list_images", payload: null, raw };
    case "ready_to_configure":
      return { type: "ready_to_configure", payload: null, raw };
    case "export_profile":
      return { type: "export_profile", payload: null, raw };
    default:
      return { tag: "PULSE_TOOL_CALL", raw, reason: "invalid_payload" };
  }
}

function parseTypedToolBlocks(reply: string): Array<ToolAction | RejectedToolAction> {
  const results: Array<ToolAction | RejectedToolAction> = [];

  for (const match of reply.matchAll(TYPED_TOOL_BLOCK_PATTERN)) {
    const rawBlock = match[0];
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      const calls = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed.tool_calls)
          ? parsed.tool_calls
          : null;
      if (!calls) {
        results.push({
          tag: "PULSE_TOOL_CALLS",
          raw: rawBlock,
          reason: "invalid_payload",
        });
        continue;
      }

      for (const call of calls) {
        const result = buildTypedToolAction(call, rawBlock);
        if (result) results.push(result);
      }
    } catch {
      results.push({
        tag: "PULSE_TOOL_CALLS",
        raw: rawBlock,
        reason: "invalid_json",
      });
    }
  }

  return results;
}

export function dryRunToolActions(reply: string): ToolActionDryRun {
  const accepted: ToolAction[] = [];
  const rejected: RejectedToolAction[] = [];
  const collect = (result: ToolAction | RejectedToolAction) => {
    if ("type" in result) accepted.push(result);
    else rejected.push(result);
  };

  for (const result of parseTypedToolBlocks(reply)) collect(result);

  for (const result of parseJsonTag(reply, "SAVE_KNOWLEDGE", (payload, raw) => {
    if (
      !isRecord(payload) ||
      typeof payload.title !== "string" ||
      typeof payload.content !== "string"
    ) {
      return { tag: "SAVE_KNOWLEDGE", raw, reason: "invalid_payload" };
    }
    return {
      type: "save_knowledge",
      payload: {
        title: payload.title,
        content: payload.content,
        priority:
          typeof payload.priority === "number" ? payload.priority : undefined,
        tags:
          Array.isArray(payload.tags) &&
          payload.tags.every((tag) => typeof tag === "string")
            ? payload.tags
            : undefined,
      },
      raw,
    };
  }))
    collect(result);

  for (const result of parseJsonTag(reply, "UPDATE_NOTE", (payload, raw) => {
    if (!isRecord(payload) || typeof payload.title !== "string") {
      return { tag: "UPDATE_NOTE", raw, reason: "invalid_payload" };
    }
    return {
      type: "update_note",
      payload: {
        title: payload.title,
        content:
          typeof payload.content === "string" ? payload.content : undefined,
        priority:
          typeof payload.priority === "number" ? payload.priority : undefined,
      },
      raw,
    };
  }))
    collect(result);

  for (const result of parseJsonTag(reply, "MERGE_NOTES", (payload, raw) => {
    if (
      !isRecord(payload) ||
      !Array.isArray(payload.titles) ||
      !payload.titles.every((title) => typeof title === "string") ||
      typeof payload.newTitle !== "string" ||
      typeof payload.newContent !== "string"
    ) {
      return { tag: "MERGE_NOTES", raw, reason: "invalid_payload" };
    }
    return {
      type: "merge_notes",
      payload: {
        titles: payload.titles,
        newTitle: payload.newTitle,
        newContent: payload.newContent,
        priority:
          typeof payload.priority === "number" ? payload.priority : undefined,
      },
      raw,
    };
  }))
    collect(result);

  const deleteMatches = reply.matchAll(/\[DELETE_NOTE:\s*"([^"]+)"\]/g);
  for (const match of deleteMatches) {
    accepted.push({ type: "delete_note", payload: match[1], raw: match[0] });
  }

  for (const result of parseJsonTag(reply, "UPDATE_SETTING", (payload, raw) => {
    if (!isRecord(payload) || !("path" in payload) || !("value" in payload)) {
      return { tag: "UPDATE_SETTING", raw, reason: "invalid_payload" };
    }
    const validatedPath = validateUpdateSettingPath(payload.path);
    if (!validatedPath.ok) {
      return {
        tag: "UPDATE_SETTING",
        raw,
        reason: "invalid_setting_path",
        details: validatedPath.reason,
      };
    }
    return {
      type: "update_setting",
      payload: {
        path: validatedPath.path,
        value: payload.value as JsonValue,
      },
      raw,
    };
  }))
    collect(result);

  for (const result of parseJsonTag(reply, "ADD_TOPIC", (payload, raw) => {
    if (!isRecord(payload) || typeof payload.query !== "string") {
      return { tag: "ADD_TOPIC", raw, reason: "invalid_payload" };
    }
    return {
      type: "add_topic",
      payload: {
        query: payload.query,
        replies:
          Array.isArray(payload.replies) &&
          payload.replies.every((replyItem) => typeof replyItem === "string")
            ? payload.replies
            : undefined,
      },
      raw,
    };
  }))
    collect(result);

  const autopilotMatch = reply.match(/\[SET_AUTOPILOT:\s*"([^"]+)"\]/);
  if (autopilotMatch)
    accepted.push({
      type: "set_autopilot",
      payload: autopilotMatch[1],
      raw: autopilotMatch[0],
    });

  const modelMatch = reply.match(/\[SET_MODEL:\s*"([^"]+)"\]/);
  if (modelMatch)
    accepted.push({
      type: "set_model",
      payload: modelMatch[1],
      raw: modelMatch[0],
    });

  for (const result of parseJsonTag(reply, "GENERATE_IMAGE", (payload, raw) => {
    if (!isRecord(payload) || typeof payload.prompt !== "string") {
      return { tag: "GENERATE_IMAGE", raw, reason: "invalid_payload" };
    }
    return {
      type: "generate_image",
      payload: {
        prompt: payload.prompt,
        tags:
          Array.isArray(payload.tags) &&
          payload.tags.every((tag) => typeof tag === "string")
            ? payload.tags
            : undefined,
      },
      raw,
    };
  }))
    collect(result);

  if (reply.includes("[LIST_IMAGES]")) {
    accepted.push({ type: "list_images", payload: null, raw: "[LIST_IMAGES]" });
  }
  if (reply.includes("[READY_TO_CONFIGURE]")) {
    accepted.push({
      type: "ready_to_configure",
      payload: null,
      raw: "[READY_TO_CONFIGURE]",
    });
  }
  if (reply.includes("[EXPORT_PROFILE]")) {
    accepted.push({
      type: "export_profile",
      payload: null,
      raw: "[EXPORT_PROFILE]",
    });
  }

  return { actions: accepted, rejected };
}

export function parseToolActions(reply: string): ToolAction[] {
  return dryRunToolActions(reply).actions;
}

export function stripToolTags(reply: string, actions: ToolAction[]): string {
  let clean = reply;
  for (const action of actions) {
    clean = clean.split(action.raw).join("");
  }
  clean = clean.replace(TYPED_TOOL_BLOCK_PATTERN, "");
  clean = clean.replace(TOOL_TAG_PATTERN, "");
  clean = clean.replace(/\n{3,}/g, "\n\n");
  return clean.trim();
}
