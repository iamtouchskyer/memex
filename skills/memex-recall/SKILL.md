---
name: memex-recall
description: Retrieve relevant memories from the Zettelkasten before starting a task. Use at the beginning of any task that might benefit from prior knowledge.
---

# Memory Recall

You have access to a Zettelkasten memory system via the `memex` CLI. Before starting this task, search your memory for relevant prior knowledge.

## Tools Available

- `memex read index` — read the keyword index (concept → card mapping)
- `memex search <query>` — full-text search body content, returns top 10 card summaries
- `memex read <slug>` — read a card's full content
- `memex search` (no args) — list all cards

## Process

```dot
digraph recall {
    "Task received" -> "memex read index";
    "memex read index" -> "Index exists?" [shape=diamond];
    "Index exists?" -> "Scan index for relevant concepts/slugs" [label="yes"];
    "Index exists?" -> "Fallback: generate 2-3 search queries" [label="no"];
    "Scan index for relevant concepts/slugs" -> "memex read <card>" ;
    "Fallback: generate 2-3 search queries" -> "memex search <query>";
    "memex search <query>" -> "Review summaries";
    "Review summaries" -> "Relevant cards found?" [shape=diamond];
    "Relevant cards found?" -> "memex read <card>" [label="yes"];
    "Relevant cards found?" -> "More queries to try?" [label="no"];
    "memex read <card>" -> "See [[links]] in content";
    "See [[links]] in content" -> "Links worth following?" [shape=diamond];
    "Links worth following?" -> "memex read <linked-card>" [label="yes"];
    "Links worth following?" -> "Enough context?" [label="no"];
    "memex read <linked-card>" -> "See [[links]] in content";
    "Enough context?" -> "More queries to try?" [label="no"];
    "More queries to try?" -> "Generate new query" [label="yes"];
    "Generate new query" -> "memex search <query>";
    "More queries to try?" -> "Summarize findings, proceed with task" [label="no"];
    "Enough context?" -> "Summarize findings, proceed with task" [label="yes"];
}
```

### Step 1: Read the keyword index

Run `memex read index` first. The index is a curated concept → card mapping (Luhmann's Schlagwortregister). It's much smaller than all cards combined and gives you the best entry points.

If the index doesn't exist yet (card not found), fall back to Step 2.

### Step 2: Targeted reads or keyword search

- **If index exists**: Pick the most relevant slugs from the index and `memex read` them directly.
- **If no index**: Generate 2-3 search keywords (try both Chinese and English terms) and run `memex search <keyword>` for each.

### Step 3: Follow links

When you read a card and see `[[links]]` in the prose, decide if they're worth following. If yes, `memex read <linked-slug>`.

### Step 4: Summarize and proceed

When you have enough context, summarize your findings and proceed with the task.

## Guardrails

- **max_hops: 3** — Do not follow links more than 3 levels deep
- **max_cards_read: 20** — Do not read more than 20 cards in a single recall
- If you hit either limit, stop and work with what you have

## Counting Rules

- Hop 0 = cards found directly via index or `memex search`. Following a `[[link]]` from there is hop 1, etc.
- Keep a running count of `memex read` calls. If you've read 20 cards, stop immediately.

## Important

- Always try `memex read index` first — it's the fastest path to relevant cards
- Generate search queries in BOTH Chinese and English to maximize recall
- If search returns nothing useful, that's fine — proceed without memory context
- Summarize what you found before proceeding, so the findings are in your context
