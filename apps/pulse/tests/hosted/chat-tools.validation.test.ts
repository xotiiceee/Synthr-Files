import { describe, expect, it } from "vitest";

import { dryRunToolActions } from "../../hosted/chat-tools.js";

describe("chat tool dry run validation", () => {
  it("reports invalid typed tool-call blocks without executable actions", () => {
    const reply =
      'Done.\n```pulse-tools\n[{"type":"update_setting","payload":{"path":"persona.tone","value":}}]\n```';

    expect(dryRunToolActions(reply)).toEqual({
      actions: [],
      rejected: [
        {
          tag: "PULSE_TOOL_CALLS",
          raw: '```pulse-tools\n[{"type":"update_setting","payload":{"path":"persona.tone","value":}}]\n```',
          reason: "invalid_json",
        },
      ],
    });
  });

  it("rejects invalid typed tool-call payloads and setting paths", () => {
    const reply = [
      "```pulse-tools",
      JSON.stringify([
        { type: "save_knowledge", payload: { title: "Missing content" } },
        {
          type: "update_setting",
          payload: { path: "persona.__proto__", value: "x" },
        },
      ]),
      "```",
    ].join("\n");

    expect(dryRunToolActions(reply).rejected).toEqual([
      {
        tag: "PULSE_TOOL_CALL",
        raw: expect.stringContaining("```pulse-tools"),
        reason: "invalid_payload",
      },
      {
        tag: "PULSE_TOOL_CALL",
        raw: expect.stringContaining("```pulse-tools"),
        reason: "invalid_setting_path",
        details: "path must use dotted identifiers only",
      },
    ]);
  });

  it("reports invalid JSON without producing executable actions", () => {
    const reply = '[SAVE_KNOWLEDGE: {"title":"Brand","content":"x",}]';

    expect(dryRunToolActions(reply)).toEqual({
      actions: [],
      rejected: [
        {
          tag: "SAVE_KNOWLEDGE",
          raw: '[SAVE_KNOWLEDGE: {"title":"Brand","content":"x",}]',
          reason: "invalid_json",
        },
      ],
    });
  });

  it("keeps behavior for supported markers while surfacing rejected mutations", () => {
    const reply = [
      "[READY_TO_CONFIGURE]",
      "[EXPORT_PROFILE]",
      '[UPDATE_SETTING: {"path":"persona.tone","value":"technical"}]',
      '[UPDATE_SETTING: {"path":"persona.__proto__","value":"x"}]',
    ].join("\n");

    expect(dryRunToolActions(reply)).toEqual({
      actions: [
        {
          type: "update_setting",
          payload: { path: "persona.tone", value: "technical" },
          raw: '[UPDATE_SETTING: {"path":"persona.tone","value":"technical"}]',
        },
        {
          type: "ready_to_configure",
          payload: null,
          raw: "[READY_TO_CONFIGURE]",
        },
        {
          type: "export_profile",
          payload: null,
          raw: "[EXPORT_PROFILE]",
        },
      ],
      rejected: [
        {
          tag: "UPDATE_SETTING",
          raw: '[UPDATE_SETTING: {"path":"persona.__proto__","value":"x"}]',
          reason: "invalid_setting_path",
          details: "path must use dotted identifiers only",
        },
      ],
    });
  });
});
