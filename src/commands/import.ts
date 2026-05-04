import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { CardStore } from "../lib/store.js";
import { getImporter, listImporters } from "../importers/index.js";

interface ImportCommandResult {
  success: boolean;
  output?: string;
  error?: string;
}

export async function importCommand(
  store: CardStore,
  source: string | undefined,
  opts: { dryRun?: boolean; dir?: string }
): Promise<ImportCommandResult> {
  if (!source) {
    const available = listImporters();
    const list = available.map(i => `  ${i.name.padEnd(12)} ${i.description}`).join("\n");
    return {
      success: true,
      output: `Available importers:\n${list}\n\nUsage: memex import <source> [--dry-run] [--dir <path>]`,
    };
  }

  const importer = getImporter(source);
  if (!importer) {
    const names = listImporters().map(i => i.name).join(", ");
    return {
      success: false,
      error: `Unknown importer: "${source}". Available: ${names}`,
    };
  }

  const sourceDir = opts.dir || join(homedir(), importer.defaultSourceDir);

  if (!existsSync(sourceDir)) {
    return {
      success: false,
      error: `Source directory not found: ${sourceDir}`,
    };
  }

  const logs: string[] = [];
  const result = await importer.run({
    store,
    sourceDir,
    dryRun: opts.dryRun,
    onLog: (msg) => logs.push(msg),
  });

  const summary = `${result.created} cards ${opts.dryRun ? "would be " : ""}created, ${result.skipped} skipped`;
  logs.push("", summary);
  if (!opts.dryRun && result.created > 0) {
    logs.push("Run 'memex serve' to visualize!");
  }

  return { success: true, output: logs.join("\n") };
}
