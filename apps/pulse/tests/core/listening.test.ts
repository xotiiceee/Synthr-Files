import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  searchPlatform: vi.fn(),
  isClawNetConfigured: vi.fn(),
  searchTweets: vi.fn(),
  getUserProfile: vi.fn(),
}));

vi.mock("../../src/core/search.js", () => ({
  search: mocks.search,
  searchPlatform: mocks.searchPlatform,
}));

vi.mock("../../src/core/clawnet-client.js", () => ({
  isClawNetConfigured: mocks.isClawNetConfigured,
  searchTweets: mocks.searchTweets,
  getUserProfile: mocks.getUserProfile,
}));

import {
  getListeningProvider,
  setListeningUsageHook,
} from "../../src/core/listening.js";

describe("ListeningProvider default facade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setListeningUsageHook(null);
  });

  it("delegates generic search to the existing search wrapper", async () => {
    const expected = [
      { url: "https://x.com/a/status/1", title: "A", snippet: "hello" },
    ];
    mocks.search.mockResolvedValue(expected);

    const provider = getListeningProvider();
    const result = await provider.search("x automation", {
      num: 5,
      timeFilter: "qdr:d",
    });

    expect(result).toBe(expected);
    expect(mocks.search).toHaveBeenCalledWith("x automation", {
      num: 5,
      timeFilter: "qdr:d",
    });
  });

  it("delegates platform search to the existing platform search wrapper", async () => {
    const expected = [
      { url: "https://reddit.com/r/test", title: "R", snippet: "thread" },
    ];
    mocks.searchPlatform.mockResolvedValue(expected);

    const provider = getListeningProvider();
    const result = await provider.searchPlatform("reddit.com", "marketing", {
      num: 10,
    });

    expect(result).toBe(expected);
    expect(mocks.searchPlatform).toHaveBeenCalledWith(
      "reddit.com",
      "marketing",
      { num: 10 },
    );
  });

  it("reports real-time X capability from ClawNet configuration", () => {
    mocks.isClawNetConfigured.mockReturnValue(false);
    expect(getListeningProvider().canSearchXRealtime()).toBe(false);

    mocks.isClawNetConfigured.mockReturnValue(true);
    expect(getListeningProvider().canSearchXRealtime()).toBe(true);
  });

  it("exposes risk and cost metadata for migration planning", () => {
    expect(getListeningProvider().getRiskProfile()).toEqual({
      provider: "default",
      riskLabel: "transitional",
      costProfile: {
        unit: "credits",
        billedBy: "provider",
        notes:
          "Generic web search uses configured search provider limits; real-time X search/profile reads use ClawNet credits when configured.",
      },
    });
  });

  it("returns no real-time X results when ClawNet is not configured", async () => {
    mocks.isClawNetConfigured.mockReturnValue(false);

    await expect(
      getListeningProvider().searchXRealtime("pulse"),
    ).resolves.toEqual([]);
    expect(mocks.searchTweets).not.toHaveBeenCalled();
  });

  it("maps ClawNet real-time tweet search results to SearchResult shape", async () => {
    mocks.isClawNetConfigured.mockReturnValue(true);
    mocks.searchTweets.mockResolvedValue({
      creditsUsed: 2,
      data: {
        tweets: [
          {
            id: "123",
            author: "founder",
            text: "Need safer X automation",
            likes: 4,
            replies: 1,
            retweets: 0,
            createdAt: "2026-05-26T01:00:00.000Z",
          },
        ],
      },
    });

    await expect(
      getListeningProvider().searchXRealtime("x automation", { limit: 3 }),
    ).resolves.toEqual([
      {
        url: "https://x.com/i/status/123",
        title: "@founder",
        snippet: "Need safer X automation",
        date: "2026-05-26T01:00:00.000Z",
      },
    ]);
    expect(mocks.searchTweets).toHaveBeenCalledWith("x automation", 3);
  });

  it("preserves real-time X search usage metadata for callers that meter credits", async () => {
    mocks.isClawNetConfigured.mockReturnValue(true);
    mocks.searchTweets.mockResolvedValue({
      creditsUsed: 4,
      data: {
        tweets: [
          {
            id: "456",
            author: "operator",
            text: "Agency X workflows are messy",
            likes: 0,
            replies: 0,
            retweets: 0,
          },
        ],
      },
    });

    await expect(
      getListeningProvider().searchXRealtimeWithUsage("agency x", { limit: 1 }),
    ).resolves.toEqual({
      creditsUsed: 4,
      results: [
        {
          url: "https://x.com/i/status/456",
          title: "@operator",
          snippet: "Agency X workflows are messy",
          date: undefined,
        },
      ],
    });
  });

  it("emits listening usage only when an explicit operationId is provided", async () => {
    mocks.isClawNetConfigured.mockReturnValue(true);
    mocks.searchTweets.mockResolvedValue({
      creditsUsed: 6,
      data: { tweets: [] },
    });
    const usageHook = vi.fn();
    setListeningUsageHook(usageHook);

    await getListeningProvider().searchXRealtimeWithUsage("agency x");
    expect(usageHook).not.toHaveBeenCalled();

    await getListeningProvider().searchXRealtimeWithUsage("agency x", {
      limit: 2,
      usage: {
        operationId: "listen_req_1",
        metadata: { route: "auto-research" },
      },
    });

    expect(usageHook).toHaveBeenCalledOnce();
    expect(usageHook).toHaveBeenCalledWith({
      action: "x.realtime_search",
      provider: "clawnet",
      operationId: "listen_req_1",
      creditsUsed: 6,
      resultCount: 0,
      query: "agency x",
      limit: 2,
      metadata: { route: "auto-research" },
    });
  });

  it("fetches X user profiles through the ClawNet-backed profile adapter when configured", async () => {
    mocks.isClawNetConfigured.mockReturnValue(true);
    mocks.getUserProfile.mockResolvedValue({
      creditsUsed: 3,
      data: {
        displayName: "Pulse",
        username: "pulse",
        followers: 100,
        following: 10,
        verified: false,
        bio: "X automation",
      },
    });

    await expect(
      getListeningProvider().getXUserProfile("@pulse"),
    ).resolves.toEqual({
      creditsUsed: 3,
      profile: {
        displayName: "Pulse",
        username: "pulse",
        followers: 100,
        following: 10,
        verified: false,
        bio: "X automation",
      },
    });
    expect(mocks.getUserProfile).toHaveBeenCalledWith("@pulse");
  });

  it("emits profile-read usage with explicit operationId metadata", async () => {
    mocks.isClawNetConfigured.mockReturnValue(true);
    mocks.getUserProfile.mockResolvedValue({
      creditsUsed: 3,
      data: {
        displayName: "Pulse",
        username: "pulse",
        followers: 100,
        following: 10,
        verified: false,
        bio: "X automation",
      },
    });
    const usageHook = vi.fn();
    setListeningUsageHook(usageHook);

    await getListeningProvider().getXUserProfile("@pulse", {
      usage: {
        operationId: "profile_req_1",
        metadata: { route: "profiles" },
      },
    });

    expect(usageHook).toHaveBeenCalledWith({
      action: "x.user_profile",
      provider: "clawnet",
      operationId: "profile_req_1",
      creditsUsed: 3,
      resultCount: 1,
      username: "@pulse",
      metadata: { route: "profiles" },
    });
  });
});
