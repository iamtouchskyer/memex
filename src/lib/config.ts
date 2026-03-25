import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface MemexConfig {
  nestedSlugs: boolean;
}

/**
 * Read config from $MEMEX_HOME/.memexrc
 * Returns default config if file doesn't exist or is invalid.
 */
export async function readConfig(memexHome: string): Promise<MemexConfig> {
  const configPath = join(memexHome, ".memexrc");

  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content);

    return {
      nestedSlugs: parsed.nestedSlugs === true,
    };
  } catch {
    // File doesn't exist or invalid JSON - return defaults
    return {
      nestedSlugs: false,
    };
  }
}
