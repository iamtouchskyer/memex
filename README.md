[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/iamtouchskyer-memex-badge.png)](https://mseep.ai/app/iamtouchskyer-memex)

# memex

Persistent memory for AI coding agents. Your agent remembers what it learned across sessions.

[English](#english) | [中文](#中文) | [日本語](#日本語) | [한국어](#한국어) | [Español](#español)

![memex timeline view](screenshot.png)

---

## English

Every time your AI agent finishes a task, it saves insights as atomic knowledge cards with `[[bidirectional links]]`. Next session, it recalls relevant cards before starting work — building on what it already knows instead of starting from scratch.

No vector database, no embeddings — just markdown files your agent (and you) can read.

### Supported platforms

| Platform | Integration | Experience |
|----------|------------|------------|
| **Claude Code** | Plugin (hooks + skills) | Best — auto-recall, slash commands, SessionStart hook |
| **VS Code / Copilot** | MCP Server | 10 MCP tools, zero config |
| **Cursor** | MCP Server | 10 MCP tools, zero config |
| **Codex** | MCP Server | 10 MCP tools, zero config |
| **Windsurf** | MCP Server | 10 MCP tools, zero config |
| **Pi** | Extension (custom tools + hooks) | 8 tools, auto-recall hook, slash commands |
| **Any MCP client** | MCP Server | 10 MCP tools, zero config |

All platforms share the same `~/.memex/cards/` directory. A card written in Claude Code is instantly available in Cursor, Codex, or any other client.

### Prerequisites

- **VS Code / Copilot**: No prerequisites — the extension bundles everything
- **Claude Code**: No prerequisites — the plugin handles everything
- **Pi**: Requires [Node.js 18+](https://nodejs.org/) and `npm install -g @touchskyer/memex`
- **All other platforms** (Cursor, Codex, Windsurf, etc.): Requires [Node.js 18+](https://nodejs.org/)

### Install

**Step 1: Add memex to your editor**

| Platform | Command |
|----------|---------|
| **VS Code / Copilot** | Search "memex" in [VS Code Extensions](https://marketplace.visualstudio.com/items?itemName=touchskyer.memex-mcp) — install and done, no extra setup |
| **Claude Code** | `/plugin marketplace add iamtouchskyer/memex` then `/plugin install memex@memex` |
| **Cursor** | First `npm install -g @touchskyer/memex`, then [one-click install](cursor://anysphere.cursor-deeplink/mcp/install?name=memex&config=eyJjb21tYW5kIjoibWVtZXgiLCJhcmdzIjpbIm1jcCJdfQ==) |
| **Codex** | `npm install -g @touchskyer/memex && codex mcp add memex -- memex mcp` |
| **Pi** | `npm install -g @touchskyer/memex && pi install npm:@touchskyer/memex` |
| **Windsurf / others** | `npm install -g @touchskyer/memex`, then add MCP server: command `memex`, args `["mcp"]` |

That's it — no extra setup needed. The MCP tool descriptions tell your agent when to recall and retro.

### Upgrade

| Platform | How |
|----------|-----|
| **VS Code / Copilot** | Extension auto-updates from marketplace |
| **Claude Code** | `/plugin uninstall memex` then `/plugin install memex@memex` |
| **Pi** | `npm update -g @touchskyer/memex` and re-copy `pi-extension/index.ts` |
| **Cursor / Codex / Windsurf** | `npm update -g @touchskyer/memex` |

### Cross-platform sharing

All clients read and write the same `~/.memex/cards/` directory. Sync across devices with git:

> **Prerequisite:** Auto-create requires [GitHub CLI](https://cli.github.com/) (`gh auth login`). Or pass your own repo URL to skip this.

```bash
memex sync --init                # auto-creates private memex-cards repo on GitHub
memex sync --init <repo-url>     # or specify your own repo URL (no gh CLI needed)
memex sync on                    # enable auto-sync after every write
memex sync                       # manual sync
memex sync off                   # disable auto-sync
```

### Browse your memory

```bash
memex serve
```

Opens a visual timeline of all your cards at `localhost:3939`. Includes a **graph view** to explore bidirectional links.

If you've set up sync, `memex serve` opens [memra.vercel.app](https://memra.vercel.app) — a web UI with Timeline, Graph view, and Share card. Pass `--local` to force the local UI instead (useful offline, or when you'd rather not send queries to a third-party web app):

```bash
memex serve --local
```

![Graph View](docs/images/graph-view.png)

### CLI reference

```bash
memex search [query]          # search cards, or list all
memex read <slug>             # read a card
memex write <slug>            # write a card (stdin)
memex links [slug]            # link graph stats
memex archive <slug>          # archive a card
memex serve                   # visual timeline UI
memex sync                    # sync via git
memex mcp                     # start MCP server (stdio)
```

### How it works

Based on Niklas Luhmann's Zettelkasten method — the system behind 70 books from 90,000 handwritten cards:

- **Atomic notes** — one idea per card
- **Own words** — forces understanding (the Feynman method)
- **Links in context** — "this relates to [[X]] because..." not just tags
- **Keyword index** — curated entry points to the card network

Cards are stored as markdown in `~/.memex/cards/`. Open them in Obsidian, edit with vim, grep from terminal. Your memory is never locked in.

---

## 中文

AI 编程 agent 的持久记忆系统。让你的 agent 跨会话记住学到的知识。

每次 agent 完成任务后，它会将洞察保存为带有 `[[双向链接]]` 的原子知识卡片。下次会话时，agent 会先回顾相关卡片再开始工作——基于已有知识继续，而非从零开始。

无需向量数据库，无需 embedding——只是你和 agent 都能读取的 markdown 文件。

### 支持平台

| 平台 | 集成方式 | 体验 |
|------|---------|------|
| **Claude Code** | Plugin（hooks + skills） | 最佳——自动回顾、斜杠命令、SessionStart hook |
| **VS Code / Copilot** | MCP Server | 10 个 MCP 工具，零配置 |
| **Cursor** | MCP Server | 10 个 MCP 工具，零配置 |
| **Codex** | MCP Server | 10 个 MCP 工具，零配置 |
| **Windsurf** | MCP Server | 10 个 MCP 工具，零配置 |
| **Pi** | Extension（自定义工具 + hooks） | 8 个工具，自动回顾 hook，斜杠命令 |
| **任何 MCP 客户端** | MCP Server | 10 个 MCP 工具，零配置 |

所有平台共享同一个 `~/.memex/cards/` 目录。在 Claude Code 中写的卡片，在 Cursor、Codex 或其他客户端中即刻可用。

### 前置要求

- **VS Code / Copilot**：无需额外安装——扩展内置了所有依赖
- **Claude Code**：无需额外安装——plugin 自动处理
- **Pi**：需要 [Node.js 18+](https://nodejs.org/) 和 `npm install -g @touchskyer/memex`
- **其他平台**（Cursor、Codex、Windsurf 等）：需要 [Node.js 18+](https://nodejs.org/)

### 安装

**第一步：添加 memex 到编辑器**

| 平台 | 命令 |
|------|------|
| **VS Code / Copilot** | 在 [VS Code 扩展商店](https://marketplace.visualstudio.com/items?itemName=touchskyer.memex-mcp) 搜索 "memex"——安装即用，无需其他配置 |
| **Claude Code** | `/plugin marketplace add iamtouchskyer/memex`，然后 `/plugin install memex@memex` |
| **Cursor** | 先 `npm install -g @touchskyer/memex`，然后 [一键安装](cursor://anysphere.cursor-deeplink/mcp/install?name=memex&config=eyJjb21tYW5kIjoibWVtZXgiLCJhcmdzIjpbIm1jcCJdfQ==) |
| **Codex** | `npm install -g @touchskyer/memex && codex mcp add memex -- memex mcp` |
| **Pi** | `npm install -g @touchskyer/memex && pi install npm:@touchskyer/memex` |
| **Windsurf / 其他** | `npm install -g @touchskyer/memex`，然后添加 MCP server：命令 `memex`，参数 `["mcp"]` |

安装完成，无需额外配置。MCP 工具描述会自动告诉 agent 何时 recall 和 retro。

---

## 日本語

AIコーディングエージェントのための永続メモリシステム。エージェントがセッションをまたいで学んだことを記憶します。

エージェントがタスクを完了するたびに、`[[双方向リンク]]`付きのアトミックな知識カードとしてインサイトを保存します。次のセッションでは、作業開始前に関連カードを呼び出し、ゼロからではなく既存の知識の上に構築します。

ベクトルデータベースもembeddingも不要——エージェント（とあなた）が読めるmarkdownファイルだけです。

### 対応プラットフォーム

| プラットフォーム | 統合方式 | 体験 |
|---------------|---------|------|
| **Claude Code** | Plugin（hooks + skills） | 最高——自動リコール、スラッシュコマンド、SessionStart hook |
| **VS Code / Copilot** | MCP Server | 10 MCPツール、設定不要 |
| **Cursor** | MCP Server | 10 MCPツール、設定不要 |
| **Codex** | MCP Server | 10 MCPツール、設定不要 |
| **Windsurf** | MCP Server | 10 MCPツール、設定不要 |
| **Pi** | Extension（カスタムツール + hooks） | 8ツール、自動リコールhook、スラッシュコマンド |
| **任意のMCPクライアント** | MCP Server | 10 MCPツール、設定不要 |

すべてのプラットフォームが同じ `~/.memex/cards/` ディレクトリを共有します。Claude Codeで書いたカードは、Cursor、Codex、その他のクライアントですぐに利用できます。

### 前提条件

- **VS Code / Copilot**：前提条件なし——拡張機能がすべてをバンドル
- **Claude Code**：前提条件なし——プラグインがすべてを処理
- **Pi**：[Node.js 18+](https://nodejs.org/) と `npm install -g @touchskyer/memex` が必要
- **その他のプラットフォーム**（Cursor、Codex、Windsurf等）：[Node.js 18+](https://nodejs.org/) が必要

### インストール

**ステップ1：エディタにmemexを追加**

| プラットフォーム | コマンド |
|---------------|---------|
| **VS Code / Copilot** | [VS Code 拡張機能](https://marketplace.visualstudio.com/items?itemName=touchskyer.memex-mcp)で "memex" を検索——インストールするだけ、追加設定不要 |
| **Claude Code** | `/plugin marketplace add iamtouchskyer/memex`、その後 `/plugin install memex@memex` |
| **Cursor** | まず `npm install -g @touchskyer/memex`、その後 [ワンクリックインストール](cursor://anysphere.cursor-deeplink/mcp/install?name=memex&config=eyJjb21tYW5kIjoibWVtZXgiLCJhcmdzIjpbIm1jcCJdfQ==) |
| **Codex** | `npm install -g @touchskyer/memex && codex mcp add memex -- memex mcp` |
| **Pi** | `npm install -g @touchskyer/memex && pi install npm:@touchskyer/memex` |
| **Windsurf / その他** | `npm install -g @touchskyer/memex`、その後MCP serverを追加：コマンド `memex`、引数 `["mcp"]` |

インストール完了、追加設定は不要です。MCPツールの説明がエージェントにリコールとレトロのタイミングを自動的に教えます。

### アップグレード

| プラットフォーム | 方法 |
|---------------|------|
| **VS Code / Copilot** | 拡張機能がマーケットプレイスから自動更新 |
| **Claude Code** | `/plugin uninstall memex` → `/plugin install memex@memex` |
| **Cursor / Codex / Windsurf** | `npm update -g @touchskyer/memex` |

---

## 한국어

AI 코딩 에이전트를 위한 영구 메모리 시스템. 에이전트가 세션을 넘어 학습한 내용을 기억합니다.

에이전트가 작업을 완료할 때마다 `[[양방향 링크]]`가 포함된 원자적 지식 카드로 인사이트를 저장합니다. 다음 세션에서는 작업 시작 전에 관련 카드를 불러와, 처음부터가 아닌 기존 지식 위에 구축합니다.

벡터 데이터베이스도 임베딩도 필요 없습니다 — 에이전트(와 당신)가 읽을 수 있는 markdown 파일뿐입니다.

### 지원 플랫폼

| 플랫폼 | 통합 방식 | 경험 |
|--------|---------|------|
| **Claude Code** | Plugin (hooks + skills) | 최고 — 자동 리콜, 슬래시 명령, SessionStart hook |
| **VS Code / Copilot** | MCP Server | 10개 MCP 도구, 설정 불필요 |
| **Cursor** | MCP Server | 10개 MCP 도구, 설정 불필요 |
| **Codex** | MCP Server | 10개 MCP 도구, 설정 불필요 |
| **Windsurf** | MCP Server | 10개 MCP 도구, 설정 불필요 |
| **Pi** | Extension (커스텀 도구 + hooks) | 8개 도구, 자동 리콜 hook, 슬래시 명령 |
| **모든 MCP 클라이언트** | MCP Server | 10개 MCP 도구, 설정 불필요 |

모든 플랫폼이 동일한 `~/.memex/cards/` 디렉토리를 공유합니다. Claude Code에서 작성한 카드를 Cursor, Codex 또는 다른 클라이언트에서 즉시 사용할 수 있습니다.

### 전제 조건

- **VS Code / Copilot**: 전제 조건 없음 — 확장 프로그램에 모든 것이 포함
- **Claude Code**: 전제 조건 없음 — 플러그인이 모든 것을 처리
- **Pi**: [Node.js 18+](https://nodejs.org/) 및 `npm install -g @touchskyer/memex` 필요
- **기타 플랫폼** (Cursor, Codex, Windsurf 등): [Node.js 18+](https://nodejs.org/) 필요

### 설치

**1단계: 에디터에 memex 추가**

| 플랫폼 | 명령 |
|--------|------|
| **VS Code / Copilot** | [VS Code 확장](https://marketplace.visualstudio.com/items?itemName=touchskyer.memex-mcp)에서 "memex" 검색 — 설치하면 끝, 추가 설정 불필요 |
| **Claude Code** | `/plugin marketplace add iamtouchskyer/memex` 후 `/plugin install memex@memex` |
| **Cursor** | 먼저 `npm install -g @touchskyer/memex`, 그런 다음 [원클릭 설치](cursor://anysphere.cursor-deeplink/mcp/install?name=memex&config=eyJjb21tYW5kIjoibWVtZXgiLCJhcmdzIjpbIm1jcCJdfQ==) |
| **Codex** | `npm install -g @touchskyer/memex && codex mcp add memex -- memex mcp` |
| **Pi** | `npm install -g @touchskyer/memex && pi install npm:@touchskyer/memex` |
| **Windsurf / 기타** | `npm install -g @touchskyer/memex`, 그런 다음 MCP server 추가: 명령 `memex`, 인수 `["mcp"]` |

설치 완료, 추가 설정이 필요 없습니다. MCP 도구 설명이 에이전트에게 리콜과 레트로 시점을 자동으로 알려줍니다.

### 업그레이드

| 플랫폼 | 방법 |
|--------|------|
| **VS Code / Copilot** | 확장 프로그램이 마켓플레이스에서 자동 업데이트 |
| **Claude Code** | `/plugin uninstall memex` → `/plugin install memex@memex` |
| **Cursor / Codex / Windsurf** | `npm update -g @touchskyer/memex` |

---

## Español

Memoria persistente para agentes de programación con IA. Tu agente recuerda lo que aprendió entre sesiones.

Cada vez que tu agente de IA termina una tarea, guarda conocimientos como tarjetas atómicas con `[[enlaces bidireccionales]]`. En la siguiente sesión, recupera las tarjetas relevantes antes de comenzar, construyendo sobre lo que ya sabe en lugar de empezar desde cero.

Sin base de datos vectorial, sin embeddings — solo archivos markdown que tu agente (y tú) pueden leer.

### Plataformas compatibles

| Plataforma | Integración | Experiencia |
|------------|------------|-------------|
| **Claude Code** | Plugin (hooks + skills) | Mejor — auto-recall, comandos slash, SessionStart hook |
| **VS Code / Copilot** | MCP Server | 10 herramientas MCP, sin configuración |
| **Cursor** | MCP Server | 10 herramientas MCP, sin configuración |
| **Codex** | MCP Server | 10 herramientas MCP, sin configuración |
| **Windsurf** | MCP Server | 10 herramientas MCP, sin configuración |
| **Pi** | Extension (herramientas personalizadas + hooks) | 8 herramientas, hook de auto-recall, comandos slash |
| **Cualquier cliente MCP** | MCP Server | 10 herramientas MCP, sin configuración |

Todas las plataformas comparten el mismo directorio `~/.memex/cards/`. Una tarjeta escrita en Claude Code está disponible instantáneamente en Cursor, Codex o cualquier otro cliente.

### Requisitos previos

- **VS Code / Copilot**: Sin requisitos previos — la extensión incluye todo
- **Claude Code**: Sin requisitos previos — el plugin se encarga de todo
- **Pi**: Requiere [Node.js 18+](https://nodejs.org/) y `npm install -g @touchskyer/memex`
- **Otras plataformas** (Cursor, Codex, Windsurf, etc.): Requiere [Node.js 18+](https://nodejs.org/)

### Instalación

**Paso 1: Agrega memex a tu editor**

| Plataforma | Comando |
|------------|---------|
| **VS Code / Copilot** | Busca "memex" en [VS Code Extensions](https://marketplace.visualstudio.com/items?itemName=touchskyer.memex-mcp) — instala y listo, sin configuración adicional |
| **Claude Code** | `/plugin marketplace add iamtouchskyer/memex`, luego `/plugin install memex@memex` |
| **Cursor** | Primero `npm install -g @touchskyer/memex`, luego [instalación con un clic](cursor://anysphere.cursor-deeplink/mcp/install?name=memex&config=eyJjb21tYW5kIjoibWVtZXgiLCJhcmdzIjpbIm1jcCJdfQ==) |
| **Codex** | `npm install -g @touchskyer/memex && codex mcp add memex -- memex mcp` |
| **Pi** | `npm install -g @touchskyer/memex && pi install npm:@touchskyer/memex` |
| **Windsurf / otros** | `npm install -g @touchskyer/memex`, luego agregar MCP server: comando `memex`, args `["mcp"]` |

Instalación completa, no se requiere configuración adicional. Las descripciones de las herramientas MCP le dicen automáticamente a tu agente cuándo hacer recall y retro.

### Actualización

| Plataforma | Cómo |
|------------|------|
| **VS Code / Copilot** | La extensión se actualiza automáticamente desde el marketplace |
| **Claude Code** | `/plugin uninstall memex` → `/plugin install memex@memex` |
| **Cursor / Codex / Windsurf** | `npm update -g @touchskyer/memex` |

---

## Community

Using memex? Share your setup in [Discussions → Show and tell](https://github.com/iamtouchskyer/memex/discussions/categories/show-and-tell). Questions go in [Q&A](https://github.com/iamtouchskyer/memex/discussions/categories/q-a). Feature ideas in [Ideas](https://github.com/iamtouchskyer/memex/discussions/categories/ideas).

---

## License

MIT
