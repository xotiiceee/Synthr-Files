import {
  generateImage,
  getAvailableModels,
  type ImageGenResult,
  type ImageModel,
} from "./image-gen.js";

export interface ImageGenerationOptions {
  model?: ImageModel;
  tags?: string[];
  categories?: string[];
  width?: number;
  height?: number;
  style?: string;
}

export interface ImageUsageEvent {
  provider: "clawnet";
  model: string;
  creditsUsed: number;
}

export type ImageUsageHook = (event: ImageUsageEvent) => void | Promise<void>;

export interface ImageProvider {
  generate(
    prompt: string,
    options?: ImageGenerationOptions,
  ): Promise<ImageGenResult>;
  listModels(): ReturnType<typeof getAvailableModels>;
}

let usageHook: ImageUsageHook | null = null;

export function setImageUsageHook(hook: ImageUsageHook | null): void {
  usageHook = hook;
}

async function emitUsage(result: ImageGenResult): Promise<void> {
  if (!usageHook) return;
  try {
    await usageHook({
      provider: "clawnet",
      model: result.model,
      creditsUsed: result.creditsUsed,
    });
  } catch (err) {
    console.warn(
      `[ImageProvider] Usage hook failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

class DefaultImageProvider implements ImageProvider {
  async generate(
    prompt: string,
    options?: ImageGenerationOptions,
  ): Promise<ImageGenResult> {
    const result = await generateImage(prompt, options);
    await emitUsage(result);
    return result;
  }

  listModels(): ReturnType<typeof getAvailableModels> {
    return getAvailableModels();
  }
}

const defaultProvider = new DefaultImageProvider();

export function getImageProvider(): ImageProvider {
  return defaultProvider;
}
