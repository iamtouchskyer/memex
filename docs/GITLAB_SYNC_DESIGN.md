# GitLab Sync Adapter Design

This document outlines a small, git-native path for improving GitLab and self-hosted GitLab support without adding a hard dependency on the GitLab CLI or GitLab APIs.

## Current State

Memex sync is already built around normal `git` commands in `src/lib/sync.ts`:

- `GitAdapter` initializes a repository, sets `origin`, commits local card content, and runs `pull`/`push`.
- Passing an explicit remote URL to `memex sync --init <git-url>` works for GitLab.com and self-hosted GitLab because the remote is handled by `git`.
- Running `memex sync --init` without a URL is a GitHub convenience path that uses `gh` to create or reuse a private `memex-cards` repository.

That means the first goal is not a platform rewrite. The core sync behavior should stay git-native.

## Goals

1. Make provider-specific behavior explicit where it helps users understand setup and status.
2. Keep normal GitLab sync based on standard git remotes.
3. Support GitLab.com and self-hosted GitLab remote formats.
4. Preserve the current GitHub auto-create flow for users who rely on `gh`.
5. Leave room for optional GitLab repository auto-create later, without requiring it for basic sync.

## Non-goals

- Do not require `glab` for `memex sync`, `memex sync push`, or `memex sync pull`.
- Do not call GitLab APIs during normal sync operations.
- Do not store GitLab personal access tokens in Memex config.
- Do not introduce a heavy dependency for remote parsing or platform detection.

## Proposed Interface

The existing `SyncAdapter` interface is already close to the right abstraction:

```ts
interface SyncAdapter {
  init(remote?: string): Promise<string>;
  pull(): Promise<SyncResult>;
  push(): Promise<SyncResult>;
  sync(): Promise<SyncResult>;
  status(): Promise<SyncStatus>;
}
```

A follow-up implementation can keep `GitAdapter` as the shared base and separate only the provider-specific initialization behavior:

```ts
type SyncProvider = "git" | "github" | "gitlab";

interface SyncAdapterFactoryOptions {
  provider?: SyncProvider;
  remote?: string;
}
```

Suggested behavior:

- `provider: "git"` or no provider: use explicit remote URL, or keep the current GitHub auto-create fallback when no URL is supplied.
- `provider: "github"`: allow the current `gh` auto-create path when no URL is supplied.
- `provider: "gitlab"`: require an explicit remote URL for now, then run the same git-native initialization path.

This keeps the implementation small while making intent visible in config and status output.

## Config Shape

Current `.sync.json` stores an `adapter` string. A compatible next step is to add an optional provider while keeping the existing field readable:

```json
{
  "adapter": "git",
  "provider": "gitlab",
  "remote": "git@gitlab.example.com:group/memex-cards.git",
  "auto": true,
  "lastSync": "2026-05-15T00:00:00.000Z"
}
```

Compatibility rules:

- Existing configs without `provider` should continue to work.
- `adapter: "git"` remains the implementation detail for shelling out to git.
- `provider` is a user-facing hint for setup, status, and future platform conveniences.

## Remote URL Handling

GitLab support should accept the same remote forms already documented in `docs/GITLAB_SYNC.md`:

```bash
git@gitlab.com:user/memex-cards.git
git@gitlab.example.com:group/memex-cards.git
ssh://git@gitlab.example.com/group/memex-cards.git
https://gitlab.example.com/group/memex-cards.git
```

Detection can stay conservative:

- Host contains `gitlab.com` or a self-hosted GitLab domain supplied by the user: report provider as GitLab.
- Unknown hosts remain generic `git`.
- Authentication is delegated to git through SSH keys, deploy keys, credential helpers, or HTTPS credentials.

## User-Facing Commands

A minimal provider-aware flow could look like this:

```bash
memex sync --init git@gitlab.example.com:group/memex-cards.git
memex sync on
memex sync --status
```

If a provider flag is added later:

```bash
memex sync --init --provider gitlab git@gitlab.example.com:group/memex-cards.git
```

For now, the most important behavior is good guidance when a GitLab provider is requested without a remote:

```text
GitLab sync requires a repository URL. Create an empty GitLab repository, then run:
memex sync --init git@gitlab.example.com:group/memex-cards.git
```

## Implementation Plan

1. Add `provider?: "git" | "github" | "gitlab"` to sync config types.
2. Keep `GitAdapter` as the implementation for all git-native remotes.
3. Add a small provider detection helper for status output and config initialization.
4. Update `memex sync --status` to show both adapter and provider when available.
5. Add tests for GitLab.com, self-hosted SSH, self-hosted `ssh://`, and self-hosted HTTPS remotes.
6. Consider GitLab repository auto-create only as a later optional feature.

## Test Plan

Recommended test coverage:

- `memex sync --init git@gitlab.com:user/memex-cards.git` writes a git remote and sync config.
- `memex sync --init git@gitlab.example.com:group/memex-cards.git` accepts self-hosted SCP-style SSH remotes.
- `memex sync --init ssh://git@gitlab.example.com/group/memex-cards.git` accepts explicit SSH remotes.
- `memex sync --init https://gitlab.example.com/group/memex-cards.git` accepts HTTPS remotes.
- `memex sync --init --provider gitlab` without a remote returns a clear error instead of trying GitHub auto-create.

## Future Optional GitLab Auto-Create

If users need repository auto-create later, that should be a separate feature. It would require explicit opt-in because self-hosted GitLab has many authentication and namespace variants:

- GitLab.com versus self-hosted base URL.
- User namespace versus group namespace.
- Personal access token versus deploy token.
- Repository visibility defaults.

Keeping this separate avoids making normal GitLab sync harder than it needs to be.
