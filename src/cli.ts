#!/usr/bin/env node
import { Command } from "commander";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
import { CardStore } from "./lib/store.js";
import { readConfig, resolveMemexHome, warnIfEmptyCards } from "./lib/config.js";
import { writeCommand } from "./commands/write.js";
import { readCommand } from "./commands/read.js";
import { searchCommand } from "./commands/search.js";
import { linksCommand } from "./commands/links.js";
import { archiveCommand } from "./commands/archive.js";
import { serveCommand } from "./commands/serve.js";
import { syncCommand } from "./commands/sync.js";
import { importCommand } from "./commands/import.js";
import { doctorCommand, doctorRunAll } from "./commands/doctor.js";
import { migrateCommand } from "./commands/migrate.js";
import { backlinksCommand } from "./commands/backlinks.js";
import { organizeCommand } from "./commands/organize.js";
import { flomoConfigCommand, flomoPushCommand, flomoImportCommand } from "./commands/flomo.js";

async function getStore(opts?: { nested?: boolean }): Promise<CardStore> {
  const home = await resolveMemexHome();
  await warnIfEmptyCards(home);
  const config = await readConfig(home);
  const nestedSlugs = opts?.nested ?? config.nestedSlugs;
  return new CardStore(join(home, "cards"), join(home, "archive"), nestedSlugs);
}

/** Flush stdout before exiting to avoid pipe-buffer truncation (Node.js issue). */
function exit(code: number): void {
  if (process.stdout.writableLength === 0) {
    process.exit(code);
  } else {
    process.stdout.once("drain", () => process.exit(code));
  }
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
  .option("-s, --semantic", "Use embedding-based semantic search")
  .option("-c, --compact", "Compact output (one line per result)")
  .option("--category <value>", "Filter by frontmatter category")
  .option("--tag <value>", "Filter by frontmatter tag")
  .option("--author <value>", "Filter by frontmatter author/source")
  .option("--since <date>", "Only cards created/modified after this date (YYYY-MM-DD)")
  .option("--before <date>", "Only cards created/modified before this date (YYYY-MM-DD)")
  .action(async (query: string | undefined, opts: { limit: string; nested?: boolean; all?: boolean; semantic?: boolean; compact?: boolean; category?: string; tag?: string; author?: string; since?: string; before?: string }) => {
    const home = await resolveMemexHome();
    const config = await readConfig(home);
    const store = await getStore({ nested: opts.nested });
    const filter = (opts.category || opts.tag || opts.author || opts.since || opts.before)
      ? { category: opts.category, tag: opts.tag, author: opts.author, since: opts.since, before: opts.before }
      : undefined;
    const result = await searchCommand(store, query, { limit: parseInt(opts.limit), all: opts.all, config, memexHome: home, semantic: opts.semantic, compact: opts.compact, filter });
    if (result.output) process.stdout.write(result.output + "\n");
    exit(result.exitCode);
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
      exit(1);
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
      exit(1);
    }
  });

program
  .command("links [slug]")
  .description("Show link graph stats or specific card links")
  .option("--filter <type>", "Filter cards: orphan or hub")
  .option("--stats", "Show summary statistics instead of card list")
  .action(async (slug?: string, cmdOpts?: { filter?: string; stats?: boolean }) => {
    const store = await getStore();
    const filter = cmdOpts?.filter as "orphan" | "hub" | undefined;
    const result = await linksCommand(store, slug, { filter, stats: cmdOpts?.stats });
    if (result.output) process.stdout.write(result.output + "\n");
    exit(result.exitCode);
  });

program
  .command("backlinks <slug>")
  .description("Show all cards that link to <slug> via [[wiki-links]]")
  .option("--nested", "Use nested (path-preserving) slugs for this command")
  .option("--all", "Search across all configured searchDirs in addition to cards/")
  .action(async (slug: string, opts: { nested?: boolean; all?: boolean }) => {
    const home = await resolveMemexHome();
    const config = await readConfig(home);
    const store = await getStore({ nested: opts.nested });
    const result = await backlinksCommand(store, slug, { all: opts.all, config, memexHome: home });
    if (result.output) process.stdout.write(result.output + "\n");
    exit(result.exitCode);
  });

program
  .command("archive <slug>")
  .description("Move a card to archive")
  .action(async (slug: string) => {
    const store = await getStore();
    const result = await archiveCommand(store, slug);
    if (!result.success) {
      process.stderr.write(result.error! + "\n");
      exit(1);
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
      const home = await resolveMemexHome();

      // memex sync on / memex sync off
      if (arg === "on" || arg === "off") {
        const result = await syncCommand(home, { auto: arg });
        if (result.output) process.stdout.write(result.output + "\n");
        if (result.error) {
          process.stderr.write(result.error + "\n");
          exit(1);
        }
        return;
      }

      // memex sync push / memex sync pull
      if (arg === "push" || arg === "pull") {
        const result = await syncCommand(home, { action: arg as "push" | "pull" });
        if (result.output) process.stdout.write(result.output + "\n");
        if (result.error) {
          process.stderr.write(result.error + "\n");
          exit(1);
        }
        return;
      }

      // memex sync status (positional alias)
      if (arg === "status") {
        const result = await syncCommand(home, { status: true });
        if (result.output) process.stdout.write(result.output + "\n");
        if (result.error) {
          process.stderr.write(result.error + "\n");
          exit(1);
        }
        return;
      }

      const result = await syncCommand(home, {
        ...opts,
        remote: opts.init ? arg : undefined,
        init: opts.init,
      });
      if (result.output) process.stdout.write(result.output + "\n");
      if (result.error) {
        process.stderr.write(result.error + "\n");
        exit(1);
      }
    }
  );

program
  .command("organize")
  .description("Analyze card network: orphans, hubs, conflicts, and contradiction pairs")
  .option("--since <date>", "Only check cards modified since this date (YYYY-MM-DD)")
  .option("--nested", "Use nested (path-preserving) slugs for this command")
  .action(async (opts: { since?: string; nested?: boolean }) => {
    const store = await getStore({ nested: opts.nested });
    const result = await organizeCommand(store, opts.since ?? null);
    if (result.output) process.stdout.write(result.output + "\n");
    exit(result.exitCode);
  });

program
  .command("mcp")
  .description("Start MCP server (stdio transport)")
  .action(async () => {
    const { createMemexServer } = await import("./mcp/server.js");
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const home = await resolveMemexHome();
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
      exit(1);
    }
  });

program
  .command("doctor")
  .description("Check memex health and configuration")
  .option("--check-collisions", "Check for slug collisions in basename mode")
  .option("--verbose", "Show detailed output for warnings")
  .option("--json", "Output results as JSON for programmatic use")
  .action(async (opts: { checkCollisions?: boolean; verbose?: boolean; json?: boolean }) => {
    const home = await resolveMemexHome();
    const cardsDir = join(home, "cards");
    const archiveDir = join(home, "archive");

    if (opts.checkCollisions) {
      const result = await doctorCommand(cardsDir, archiveDir);
      if (result.output) process.stdout.write(result.output + "\n");
      exit(result.exitCode);
    } else {
      const result = await doctorRunAll(cardsDir, archiveDir, opts.verbose, opts.json);
      if (result.output) process.stdout.write(result.output + "\n");
      exit(result.exitCode);
    }
  });

program
  .command("migrate")
  .description("Migrate memex configuration")
  .option("--enable-nested", "Enable nestedSlugs in config")
  .action(async (opts: { enableNested?: boolean }) => {
    const home = await resolveMemexHome();
    const cardsDir = join(home, "cards");
    const archiveDir = join(home, "archive");

    if (opts.enableNested) {
      const result = await migrateCommand(home, cardsDir, archiveDir);
      if (result.output) process.stdout.write(result.output + "\n");
      if (!result.success) {
        if (result.error) process.stderr.write(result.error + "\n");
        exit(1);
      }
    } else {
      process.stderr.write("No migration specified. Use --enable-nested to enable nestedSlugs.\n");
      exit(1);
    }
  });

const flomo = program
  .command("flomo")
  .description("Flomo integration (push/import/config)");

flomo
  .command("config")
  .description("Configure flomo webhook URL")
  .option("--set-webhook <url>", "Set the flomo webhook URL")
  .option("--show", "Show current configuration")
  .action(async (opts: { setWebhook?: string; show?: boolean }) => {
    const home = await resolveMemexHome();
    const result = await flomoConfigCommand(home, opts);
    process.stdout.write(result.output + "\n");
    exit(result.exitCode);
  });

flomo
  .command("push [slug]")
  .description("Push card(s) to flomo")
  .option("--all", "Push all matching cards")
  .option("--source <value>", "Filter by source")
  .option("--tag <value>", "Filter by tag or category")
  .option("--dry-run", "Preview without pushing")
  .action(async (slug: string | undefined, opts: { all?: boolean; source?: string; tag?: string; dryRun?: boolean }) => {
    if (!slug && !opts.all && !opts.source && !opts.tag) {
      process.stderr.write("Error: specify a slug or use --all/--source/--tag to filter.\n");
      exit(1);
    }
    const home = await resolveMemexHome();
    const store = await getStore();
    const result = await flomoPushCommand(store, home, slug, opts);
    process.stdout.write(result.output + "\n");
    exit(result.exitCode);
  });

flomo
  .command("import <file>")
  .description("Import memos from flomo HTML export")
  .option("--dry-run", "Preview without writing cards")
  .action(async (file: string, opts: { dryRun?: boolean }) => {
    const store = await getStore();
    const result = await flomoImportCommand(store, file, opts);
    process.stdout.write(result.output + "\n");
    exit(result.exitCode);
  });

program.parse();
