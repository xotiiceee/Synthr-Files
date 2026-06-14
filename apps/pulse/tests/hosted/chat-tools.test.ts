import { describe, expect, it } from "vitest";

import {
  parseToolActions,
  stripToolTags,
} from "../../hosted/pages/chat-setup.js";
import {
  dryRunToolActions,
  validateUpdateSettingPath,
} from "../../hosted/chat-tools.js";

describe("chat tool tag parsing", () => {
  it("parses preferred typed tool-call blocks in model order", () => {
    const reply = [
      "I captured the launch details.",
      "```pulse-tools",
      JSON.stringify(
        [
          {
            type: "update_setting",
            payload: { path: "persona.tone", value: "technical" },
          },
          {
            type: "save_knowledge",
            payload: {
              title: "Launch positioning",
              content: "Pulse is focused on serious X automation.",
              priority: 2,
              tags: ["positioning"],
            },
          },
          { type: "export_profile", payload: null },
        ],
        null,
        2,
      ),
      "```",
      "Ready.",
    ].join("\n");

    const actions = parseToolActions(reply);

    expect(actions.map((action) => action.type)).toEqual([
      "update_setting",
      "save_knowledge",
      "export_profile",
    ]);
    expect(actions[0]).toMatchObject({
      payload: { path: "persona.tone", value: "technical" },
    });
    expect(actions[1]).toMatchObject({
      payload: {
        title: "Launch positioning",
        content: "Pulse is focused on serious X automation.",
        priority: 2,
        tags: ["positioning"],
      },
    });
    expect(stripToolTags(reply, actions)).toBe(
      "I captured the launch details.\n\nReady.",
    );
  });

  it("parses supported JSON-backed actions in order by action family", () => {
    const reply = [
      "Saved.",
      '[SAVE_KNOWLEDGE: {"title":"Brand","content":"Pulse is X-only","priority":2}]',
      '[UPDATE_SETTING: {"path":"persona.tone","value":"technical"}]',
      '[ADD_TOPIC: {"query":"x automation","replies":["helpful reply"]}]',
      '[GENERATE_IMAGE: {"prompt":"clean product screenshot","tags":["product"]}]',
    ].join("\n");

    const actions = parseToolActions(reply);

    expect(actions).toEqual([
      {
        type: "save_knowledge",
        payload: { title: "Brand", content: "Pulse is X-only", priority: 2 },
        raw: '[SAVE_KNOWLEDGE: {"title":"Brand","content":"Pulse is X-only","priority":2}]',
      },
      {
        type: "update_setting",
        payload: { path: "persona.tone", value: "technical" },
        raw: '[UPDATE_SETTING: {"path":"persona.tone","value":"technical"}]',
      },
      {
        type: "add_topic",
        payload: { query: "x automation", replies: ["helpful reply"] },
        raw: '[ADD_TOPIC: {"query":"x automation","replies":["helpful reply"]}]',
      },
      {
        type: "generate_image",
        payload: { prompt: "clean product screenshot", tags: ["product"] },
        raw: '[GENERATE_IMAGE: {"prompt":"clean product screenshot","tags":["product"]}]',
      },
    ]);
  });

  it("parses scalar and marker actions", () => {
    const reply = [
      '[DELETE_NOTE: "Old fact"]',
      '[SET_AUTOPILOT: "semi"]',
      '[SET_MODEL: "claude-sonnet"]',
      "[LIST_IMAGES]",
      "[READY_TO_CONFIGURE]",
      "[EXPORT_PROFILE]",
    ].join("\n");

    expect(
      parseToolActions(reply).map((action) => [action.type, action.payload]),
    ).toEqual([
      ["delete_note", "Old fact"],
      ["set_autopilot", "semi"],
      ["set_model", "claude-sonnet"],
      ["list_images", null],
      ["ready_to_configure", null],
      ["export_profile", null],
    ]);
  });

  it("silently ignores malformed JSON actions but strips the raw tag from visible output", () => {
    const reply =
      'I saved it.\n[UPDATE_SETTING: {"path":"persona.tone","value":]\nContinue.';
    const actions = parseToolActions(reply);

    expect(actions).toEqual([]);
    expect(stripToolTags(reply, actions)).toBe("I saved it.\n\nContinue.");
  });

  it("rejects invalid UPDATE_SETTING paths and strips them from visible output", () => {
    const reply =
      'Applied.\n[UPDATE_SETTING: {"path":"../secrets.token","value":"x"}]\nDone.';
    const dryRun = dryRunToolActions(reply);

    expect(parseToolActions(reply)).toEqual([]);
    expect(dryRun.rejected).toEqual([
      {
        tag: "UPDATE_SETTING",
        raw: '[UPDATE_SETTING: {"path":"../secrets.token","value":"x"}]',
        reason: "invalid_setting_path",
        details: "path must use dotted identifiers only",
      },
    ]);
    expect(stripToolTags(reply, [])).toBe("Applied.\n\nDone.");
  });

  it("strips successfully parsed tags and collapses extra blank lines", () => {
    const reply =
      'First.\n\n[SAVE_KNOWLEDGE: {"title":"A","content":"B","priority":1}]\n\n\nDone.';
    const actions = parseToolActions(reply);

    expect(stripToolTags(reply, actions)).toBe("First.\n\nDone.");
  });

  it("parses nested JSON payload values and strips mixed tool tags from visible output", () => {
    const reply = [
      "Configured.",
      '[UPDATE_SETTING: {"path":"persona.neverSay","value":{"blocked":["cheap","spammy"],"reason":"brand safety"}}]',
      '[SAVE_KNOWLEDGE: {"title":"Voice","content":"Use crisp operator language","tags":["voice","positioning"]}]',
      "Ready for review. [EXPORT_PROFILE]",
    ].join("\n");

    const actions = parseToolActions(reply);

    expect(actions).toEqual([
      {
        type: "save_knowledge",
        payload: {
          title: "Voice",
          content: "Use crisp operator language",
          tags: ["voice", "positioning"],
        },
        raw: '[SAVE_KNOWLEDGE: {"title":"Voice","content":"Use crisp operator language","tags":["voice","positioning"]}]',
      },
      {
        type: "update_setting",
        payload: {
          path: "persona.neverSay",
          value: {
            blocked: ["cheap", "spammy"],
            reason: "brand safety",
          },
        },
        raw: '[UPDATE_SETTING: {"path":"persona.neverSay","value":{"blocked":["cheap","spammy"],"reason":"brand safety"}}]',
      },
      { type: "export_profile", payload: null, raw: "[EXPORT_PROFILE]" },
    ]);
    expect(stripToolTags(reply, actions)).toBe(
      "Configured.\n\nReady for review.",
    );
  });

  it("validates allowed UPDATE_SETTING paths through the helper", () => {
    expect(validateUpdateSettingPath("persona.tone")).toEqual({
      ok: true,
      path: "persona.tone",
    });
    expect(validateUpdateSettingPath("persona.unknown")).toEqual({
      ok: false,
      reason: "path is not in the allowed UPDATE_SETTING whitelist",
    });
  });
});
