import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { doctorCommand } from "./doctor.js";

interface MigrateResult {
  success: boolean;
  output?: string;
  error?: string;
}

export async function migrateCommand(
  memexHome: string,
  cardsDir: string,
  archiveDir: string
): Promise<MigrateResult> {
  try {
    // First check for collisions
    const doctorResult = await doctorCommand(cardsDir, archiveDir);
    if (doctorResult.exitCode !== 0) {
      return {
        success: false,
        error: `${doctorResult.output}\n\nResolve collisions before enabling nestedSlugs.`,
      };
    }

    // No collisions, safe to enable nestedSlugs
    const configPath = join(memexHome, ".memexrc");
    let config: Record<string, unknown> = {};

    // Read existing config if it exists
    try {
      const content = await readFile(configPath, "utf-8");
      config = JSON.parse(content);
    } catch {
      // File doesn't exist or invalid JSON - start with empty config
    }

    // Set nestedSlugs to true
    config.nestedSlugs = true;

    // Write config back
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

    return {
      success: true,
      output: `✓ Enabled nestedSlugs in ${configPath}\n${doctorResult.output}`,
    };
  } catch (e) {
    return {
      success: false,
      error: `Failed to enable nestedSlugs: ${(e as Error).message}`,
    };
  }
}
