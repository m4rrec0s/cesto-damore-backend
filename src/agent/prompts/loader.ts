import { readFileSync } from "fs";
import { resolve } from "path";

const PROMPTS_DIR = resolve(__dirname, "../../../../prompts");
const cache = new Map<string, string>();

export function loadPrompt(
  relativePath: string,
  vars?: Record<string, string>,
): string {
  let content = cache.get(relativePath);

  if (!content) {
    const filePath = resolve(PROMPTS_DIR, relativePath);
    content = readFileSync(filePath, "utf-8");
    cache.set(relativePath, content);
  }

  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      content = content.split(`{{${key}}}`).join(value);
    }
  }

  return content;
}

export function clearPromptCache(): void {
  cache.clear();
}
