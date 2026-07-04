import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  getAvailableModels: vi.fn(),
}));

vi.mock("../../src/intelligence/image-gen.js", () => ({
  generateImage: mocks.generateImage,
  getAvailableModels: mocks.getAvailableModels,
}));

const { getImageProvider, setImageUsageHook } =
  await import("../../src/intelligence/image-provider.js");

describe("ImageProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setImageUsageHook(null);
  });

  it("delegates generation to the existing image generator", async () => {
    const result = {
      imageUrl: "https://example.test/image.png",
      asset: { id: "asset_1" },
      creditsUsed: 3,
      provenance: null,
      model: "FLUX Schnell",
    };
    mocks.generateImage.mockResolvedValue(result);

    await expect(
      getImageProvider().generate("launch image", { model: "fast" }),
    ).resolves.toBe(result);
    expect(mocks.generateImage).toHaveBeenCalledWith("launch image", {
      model: "fast",
    });
  });

  it("emits image usage metadata after generation", async () => {
    const hook = vi.fn();
    setImageUsageHook(hook);
    mocks.generateImage.mockResolvedValue({
      imageUrl: "https://example.test/image.png",
      asset: { id: "asset_1" },
      creditsUsed: 12,
      provenance: null,
      model: "Freepik Mystic",
    });

    await getImageProvider().generate("campaign visual");

    expect(hook).toHaveBeenCalledWith({
      provider: "clawnet",
      model: "Freepik Mystic",
      creditsUsed: 12,
    });
  });

  it("does not fail generation when the usage hook fails", async () => {
    const result = {
      imageUrl: "https://example.test/image.png",
      asset: { id: "asset_1" },
      creditsUsed: 5,
      provenance: null,
      model: "FLUX.2 Pro",
    };
    setImageUsageHook(() => {
      throw new Error("hook failed");
    });
    mocks.generateImage.mockResolvedValue(result);

    await expect(getImageProvider().generate("product shot")).resolves.toBe(
      result,
    );
  });

  it("lists available image models", () => {
    const models = [
      { id: "fast", label: "FLUX Schnell", costEstimate: "~$0.015" },
    ];
    mocks.getAvailableModels.mockReturnValue(models);

    expect(getImageProvider().listModels()).toBe(models);
  });
});
