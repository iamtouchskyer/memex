#!/usr/bin/env node
/**
 * Import OpenClaw daily memory files into Memex cards.
 *
 * Usage:
 *   node scripts/import-openclaw.mjs [--dry-run]
 */

import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENCLAW_MEMORY = join(homedir(), ".openclaw", "workspace", "memory");
const MEMEX_HOME = process.env.MEMEX_HOME || join(homedir(), ".memex");
const DRY_RUN = process.argv.includes("--dry-run");

const storeModule = await import(pathToFileURL(join(__dirname, "..", "dist", "lib", "store.js")).href);
const importModule = await import(pathToFileURL(join(__dirname, "..", "dist", "lib", "import-openclaw.js")).href);

const { CardStore } = storeModule;
const { importOpenClawMemory } = importModule;

if (!existsSync(OPENCLAW_MEMORY)) {
  console.error(`OpenClaw memory directory not found: ${OPENCLAW_MEMORY}`);
  process.exit(1);
}

const store = new CardStore(join(MEMEX_HOME, "cards"), join(MEMEX_HOME, "archive"));
const result = await importOpenClawMemory({
  memoryDir: OPENCLAW_MEMORY,
  store,
  dryRun: DRY_RUN,
});

console.log(`\nDone: ${result.created} cards ${DRY_RUN ? "would be " : ""}created, ${result.skipped} skipped (already exist)`);
console.log(`Cards directory: ${join(MEMEX_HOME, "cards")}`);
if (!DRY_RUN && result.created > 0) {
  console.log(`\nRun 'memex serve' to visualize!`);
}
