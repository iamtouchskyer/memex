#!/usr/bin/env node
import { Command } from "commander";
import { join } from "node:path";
import { homedir } from "node:os";
import { CardStore } from "./lib/store.js";
import { writeCommand } from "./commands/write.js";
import { readCommand } from "./commands/read.js";
import { searchCommand } from "./commands/search.js";
import { linksCommand } from "./commands/links.js";
import { archiveCommand } from "./commands/archive.js";

function getStore(): CardStore {
  const home = process.env.MEMEX_HOME || join(homedir(), ".memex");
  return new CardStore(join(home, "cards"), join(home, "archive"));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

const program = new Command();
program.name("memex").description("Zettelkasten agent memory CLI").version("0.1.0");

program
  .command("search [query]")
  .description("Full-text search cards (body only), or list all if no query")
  .option("-l, --limit <n>", "Max results to return", "10")
  .action(async (query: string | undefined, opts: { limit: string }) => {
    const store = getStore();
    const result = await searchCommand(store, query, { limit: parseInt(opts.limit) });
    if (result.output) process.stdout.write(result.output + "\n");
    process.exit(result.exitCode);
  });

program
  .command("read <slug>")
  .description("Read a card's full content")
  .action(async (slug: string) => {
    const store = getStore();
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
    const store = getStore();
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
    const store = getStore();
    const result = await linksCommand(store, slug);
    if (result.output) process.stdout.write(result.output + "\n");
    process.exit(result.exitCode);
  });

program
  .command("archive <slug>")
  .description("Move a card to archive")
  .action(async (slug: string) => {
    const store = getStore();
    const result = await archiveCommand(store, slug);
    if (!result.success) {
      process.stderr.write(result.error! + "\n");
      process.exit(1);
    }
  });

program.parse();
