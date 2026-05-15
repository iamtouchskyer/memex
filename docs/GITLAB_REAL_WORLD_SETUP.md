# GitLab Real-World Setup Examples

Memex sync works with GitLab because it uses normal `git` remotes. The only GitHub-specific convenience is repository auto-creation when `memex sync --init` is run without a URL. For GitLab, create the repository first, then initialize Memex with the remote URL.

## Self-hosted GitLab over SSH

Create an empty private repository in your GitLab instance, then initialize sync with the SSH remote:

```bash
memex sync --init git@gitlab.example.com:group/memex-cards.git
memex sync on
memex sync
```

Use this form when your SSH key or deploy key already works with the GitLab instance:

```bash
git ls-remote git@gitlab.example.com:group/memex-cards.git
```

If that command can read the empty repository, Memex can use the same credentials.

## Self-hosted GitLab over HTTPS

HTTPS remotes work too:

```bash
memex sync --init https://gitlab.example.com/group/memex-cards.git
memex sync on
memex sync
```

For private repositories, configure credentials through Git before running Memex. For example, use your system credential helper or GitLab's recommended personal access token flow. Avoid embedding a token directly in the remote URL because it can be written to shell history, process lists, or Memex config.

A quick credential check is:

```bash
git ls-remote https://gitlab.example.com/group/memex-cards.git
```

## GitLab.com

GitLab.com follows the same pattern:

```bash
memex sync --init git@gitlab.com:user/memex-cards.git
memex sync on
memex sync
```

or, for HTTPS:

```bash
memex sync --init https://gitlab.com/user/memex-cards.git
```

## Common troubleshooting

- If `memex sync --init` without a URL tries to use GitHub, pass the GitLab remote URL explicitly.
- If sync fails with an authentication error, run `git ls-remote <repo-url>` with the same URL. Fix Git credentials first, then retry Memex.
- If using a self-hosted instance with a custom SSH port, use the full SSH URL form, for example `ssh://git@gitlab.example.com:2222/group/memex-cards.git`.
- If the repository is new and empty, create it in GitLab before initializing Memex. Memex does not call GitLab APIs or create GitLab repositories today.

## What is still missing

These examples cover normal GitLab-backed sync. They do not add GitLab repository auto-creation, `glab` integration, or provider-specific sync status. Those should stay separate design discussions so the default sync path remains git-native and lightweight.
