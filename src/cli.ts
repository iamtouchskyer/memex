#!/usr/bin/env node
import { Command } from "commander";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
import { CardStore } from "./lib/store.js";
import { readConfig } from "./lib/config.js";
import { writeCommand } from "./commands/write.js";
import { readCommand } from "./commands/read.js";
import { searchCommand } from "./commands/search.js";
import { linksCommand } from "./commands/links.js";
import { archiveCommand } from "./commands/archive.js";
import { serveCommand } from "./commands/serve.js";
import { syncCommand } from "./commands/sync.js";
import { importCommand } from "./commands/import.js";
import { doctorCommand } from "./commands/doctor.js";
import { migrateCommand } from "./commands/migrate.js";

async function getStore(opts?: { nested?: boolean }): Promise<CardStore> {
  const home = process.env.MEMEX_HOME || join(homedir(), ".memex");
  const config = await readConfig(home);
  const nestedSlugs = opts?.nested ?? config.nestedSlugs;
  return new CardStore(join(home, "cards"), join(home, "archive"), nestedSlugs);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

const program = new Command();
program.name("memex").description("Zettelkasten agent memory CLI").version(pkg.version);

program
  .command("search [query]")
  .description("Full-text search cards (body only), or list all if no query")
  .option("-l, --limit <n>", "Max results to return", "10")
  .option("--nested", "Use nested (path-preserving) slugs for this command")
  .option("--all", "Search across all configured searchDirs in addition to cards/")
  .action(async (query: string | undefined, opts: { limit: string; nested?: boolean; all?: boolean }) => {
    const home = process.env.MEMEX_HOME || join(homedir(), ".memex");
    const config = await readConfig(home);
    const store = await getStore({ nested: opts.nested });
    const result = await searchCommand(store, query, { limit: parseInt(opts.limit), all: opts.all, config, memexHome: home });
    if (result.output) process.stdout.write(result.output + "\n");
    process.exit(result.exitCode);
  });

program
  .command("read <slug>")
  .description("Read a card's full content")
  .option("--nested", "Use nested (path-preserving) slugs for this command")
  .action(async (slug: string, opts: { nested?: boolean }) => {
    const store = await getStore({ nested: opts.nested });
    const result = await readCommand(store, slug);
    if (result.success) {
      process.stdout.write(result.content! + "\n");
    } else {
      process.stderr.write(result.error! + "\n");
      process.exit(1);
    }
  });

program
  .command("write <slug>")
  .description("Write a card (content via stdin)")
  .action(async (slug: string) => {
    const store = await getStore();
    const input = await readStdin();
    const result = await writeCommand(store, slug, input);
    if (!result.success) {
      process.stderr.write(result.error! + "\n");
      process.exit(1);
    }
  });

program
  .command("links [slug]")
  .description("Show link graph stats or specific card links")
  .action(async (slug?: string) => {
    const store = await getStore();
    const result = await linksCommand(store, slug);
    if (result.output) process.stdout.write(result.output + "\n");
    process.exit(result.exitCode);
  });

program
  .command("archive <slug>")
  .description("Move a card to archive")
  .action(async (slug: string) => {
    const store = await getStore();
    const result = await archiveCommand(store, slug);
    if (!result.success) {
      process.stderr.write(result.error! + "\n");
      process.exit(1);
    }
  });

program
  .command("serve")
  .description("Start web UI for browsing cards")
  .option("-p, --port <n>", "Port number", "3939")
  .action(async (opts: { port: string }) => {
    await serveCommand(parseInt(opts.port));
  });

program
  .command("sync")
  .description("Sync cards across devices via git")
  .option("--init", "Initialize sync")
  .option("--status", "Show sync status")
  .argument("[arg]", "Remote URL (for --init) or on/off (toggle auto-sync)")
  .action(
    async (
      arg: string | undefined,
      opts: { init?: boolean; status?: boolean }
    ) => {
      const home = process.env.MEMEX_HOME || join(homedir(), ".memex");

      // memex sync on / memex sync off
      if (arg === "on" || arg === "off") {
        const result = await syncCommand(home, { auto: arg });
        if (result.output) process.stdout.write(result.output + "\n");
        if (result.error) {
          process.stderr.write(result.error + "\n");
          process.exit(1);
        }
        return;
      }

      const result = await syncCommand(home, {
        ...opts,
        remote: arg,
        init: opts.init || !!arg,
      });
      if (result.output) process.stdout.write(result.output + "\n");
      if (result.error) {
        process.stderr.write(result.error + "\n");
        process.exit(1);
      }
    }
  );

program
  .command("mcp")
  .description("Start MCP server (stdio transport)")
  .action(async () => {
    const { createMemexServer } = await import("./mcp/server.js");
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const home = process.env.MEMEX_HOME || join(homedir(), ".memex");
    const store = await getStore();
    const server = createMemexServer(store, home);
    const transport = new StdioServerTransport();
    console.error("memex MCP server running on stdio");
    await server.connect(transport);
  });

program
  .command("import [source]")
  .description("Import memories from other tools (openclaw, ...)")
  .option("--dry-run", "Preview without writing")
  .option("--dir <path>", "Override source directory")
  .action(async (source: string | undefined, opts: { dryRun?: boolean; dir?: string }) => {
    const store = await getStore();
    const result = await importCommand(store, source, opts);
    if (result.output) process.stdout.write(result.output + "\n");
    if (!result.success) {
      if (result.error) process.stderr.write(result.error + "\n");
      process.exit(1);
    }
  });

program
  .command("doctor")
  .description("Check memex health and configuration")
  .option("--check-collisions", "Check for slug collisions in basename mode")
  .action(async (opts: { checkCollisions?: boolean }) => {
    const home = process.env.MEMEX_HOME || join(homedir(), ".memex");
    const cardsDir = join(home, "cards");
    const archiveDir = join(home, "archive");

    if (opts.checkCollisions) {
      const result = await doctorCommand(cardsDir, archiveDir);
      if (result.output) process.stdout.write(result.output + "\n");
      process.exit(result.exitCode);
    } else {
      process.stderr.write("No check specified. Use --check-collisions to check for slug collisions.\n");
      process.exit(1);
    }
  });

program
  .command("migrate")
  .description("Migrate memex configuration")
  .option("--enable-nested", "Enable nestedSlugs in config")
  .action(async (opts: { enableNested?: boolean }) => {
    const home = process.env.MEMEX_HOME || join(homedir(), ".memex");
    const cardsDir = join(home, "cards");
    const archiveDir = join(home, "archive");

    if (opts.enableNested) {
      const result = await migrateCommand(home, cardsDir, archiveDir);
      if (result.output) process.stdout.write(result.output + "\n");
      if (!result.success) {
        if (result.error) process.stderr.write(result.error + "\n");
        process.exit(1);
      }
    } else {
      process.stderr.write("No migration specified. Use --enable-nested to enable nestedSlugs.\n");
      process.exit(1);
    }
  });

program.parse();
