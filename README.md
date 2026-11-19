# folio-axi

<!-- readme-axi type=tool -->

**English** · [Tiếng Việt](README.vi.md)

Folio opens agent-made HTML pages in your browser. You point at elements, mark up text and diagrams, answer questions on the page, and your feedback always reaches the Claude Code session that made the page. Built for Claude Code on Windows; works from another machine on your LAN or tailnet.

Folio is [lavish-axi](https://github.com/kunchenguid/lavish-axi) 0.1.96 by Kun Chen (MIT), maintained by [ngoviet](https://github.com/ngoviet). It is not published to npm. Background, plan and status (Vietnamese): [docs/folio/README.md](docs/folio/README.md).

| Folio adds                         | What it means for you                                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Right session, every time          | `folio-axi <file>` records the Claude Code session that opened the page. A poll from another session gets `NOT_OWNER` unless it passes `--takeover`.                                               |
| No silent loss                     | A batch is acked only after the agent printed it; an interrupted poll gets it again. A poll cut by a server restart reconnects on its own.                                                         |
| Hooks for active and idle sessions | SessionStart lists this folder's pages, Stop and UserPromptSubmit hand over unread feedback, SessionEnd tells the page nobody is left to read it. A tracked background poll wakes an idle session. |
| Remote-friendly                    | When the review link is a LAN or Tailscale address, the agent is told to send it to you, because the browser only opens on the host machine.                                                       |
| Windows-first                      | Stale servers found with `netstat`, no console window, fast startup (no waiting on silent network adapters).                                                                                       |
| Runs beside lavish-axi             | State in `~/.folio-axi`, port `4388`, variables `FOLIO_AXI_*`. No telemetry.                                                                                                                       |

Pages written for Lavish work unchanged: the page SDK keeps `window.lavish.*`, `data-lavish-*`, `%% lavish-icon` and `lavish:*`. Folio is an [AXI](https://axi.md): a plain CLI with compact TOON output that agents learn by using.

## Installation

Folio is not on npm. From a checkout (Node 22 or later, pnpm):

```sh
pnpm install
npm link
folio-axi setup hooks          # preview
folio-axi setup hooks --write  # merge Claude Code hooks into ~/.claude/settings.json
```

Restart the Claude Code session after installing hooks. They call this checkout's `bin/folio-axi.js` with `node` directly, so run `folio-axi setup hooks --write` again if you move the checkout. `npm link` does not rebuild: after `git pull`, run `pnpm run build`. The `skills/folio` skill points agents at the CLI's own help, design guidance and playbooks.

## Usage

1. The agent writes an HTML page, by default under `.folio/` in the project.
2. `folio-axi .folio/plan.html` opens it in the browser. Use Chrome or another regular browser: the Claude app's built-in browser blocks the sandboxed frame on a local address.
3. The agent runs `folio-axi poll .folio/plan.html` as a tracked background task and ends its turn.
4. You annotate elements or text, answer the page's questions, and press **Send to Agent**. The poll hands your notes to the session that opened the page.
5. The agent answers with `folio-axi reply` (or `poll --agent-reply`) and polls again. **Send & End** in the browser, or `folio-axi end`, closes the review.

Reviewing from another device: set `FOLIO_AXI_HOST` (and `FOLIO_AXI_LINK_HOST`) to this machine's LAN address, or run Tailscale, and open the link the agent sends you. See [Network binding](docs/reference.md#network-binding).

## How it works

```
agent writes page.html ──▶ folio-axi page.html ──▶ browser review page
                                                        │ notes, answers
agent reads feedback   ◀── folio-axi poll page.html ◀───┘ Send to Agent
```

- **Identity** - A session is the canonical path of the HTML file; there are no opaque IDs. The top bar and the tab title name the project the page reports for (its git root, or the folder with `CLAUDE.md`/`AGENTS.md`/`.claude`; a worktree shows its repository), with the full path on hover. Clicking it shows or hides a strip with the project path, git branch, the page's path in the project, the machine and when the page was last saved; the browser remembers the choice. The page runs in a sandboxed iframe with a small injected SDK, so the saved file renders the same inside and outside Folio.
- **Review page** - Annotate elements, text selections, table cells and diagram nodes; attach images; edit Mermaid diagrams as Excalidraw whiteboards. Unsent notes stay in the tab where you wrote them; sent notes show 👀 Seen, 🛠️ Working and ✅ Done receipts.
- **Agent replies** - Replies render a small Markdown subset: paragraphs, line breaks, headings as bold lead lines, bullet and numbered lists, fenced and inline code, bold, italic and http(s) links. Tables, images and raw HTML stay as written; your own messages are never parsed.
- **Layout checks** - The page is revealed after a quick in-browser layout audit. Problems it proves go to a passive **Layout issues** inbox and reach the agent only when you queue them.
- **Live reload** - Folio watches the file and reloads the page when the agent saves it, keeping scroll position, open drafts and answers.
- **Server** - One background server on port `4388` serves every session and stops itself when idle. Waiting polls survive its restarts.
- **Export and sharing** - `folio-axi export` writes one self-contained HTML file. `folio-axi share` publishes to the third-party host [ht-ml.app](https://ht-ml.app), public by default or behind a password.

### Allowed hosts

To defend against DNS rebinding, the server answers only `Host` headers it knows: loopback names, plus the Tailscale address and MagicDNS name when that listener is bound. Add any other name you use (a LAN hostname, a reverse proxy) to `FOLIO_AXI_ALLOWED_HOSTS`, whitespace-separated; `*` turns the check off, only behind your own authentication. Mutating routes also reject a foreign `Origin` or `Referer`. Proxy rules (`X-Forwarded-Host`, `X-Forwarded-Proto`) are in [docs/reference.md](docs/reference.md#allowed-hosts).

### Configuration

| Variable                                 | Default               | Effect                                                                                                             |
| ---------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `FOLIO_AXI_PORT`                         | `4388`                | Server port.                                                                                                       |
| `FOLIO_AXI_STATE_DIR`                    | `~/.folio-axi`        | Sessions, attachments, `server.log`.                                                                               |
| `FOLIO_AXI_HOST` / `FOLIO_AXI_LINK_HOST` | Tailscale or loopback | Listen address (replaces automatic Tailscale; loopback always kept) / host used in review links. Never a wildcard. |
| `FOLIO_AXI_ALLOWED_HOSTS`                | loopback              | Extra `Host` names to accept (see above).                                                                          |
| `FOLIO_AXI_NO_OPEN`                      | off                   | `1` creates the session without launching a browser, like `--no-open`.                                             |
| `FOLIO_AXI_IDLE_TIMEOUT_MS`              | 30 min                | Idle self-shutdown; `0`/`off` disables.                                                                            |
| `FOLIO_AXI_DISCONNECT_GRACE_MS`          | off                   | Release a waiting poll after every review tab has been gone this long.                                             |
| `FOLIO_AXI_STOP_HOOK`                    | on                    | `0` turns off the Stop hook's blocks.                                                                              |
| `FOLIO_AXI_ENDED_RETENTION_DAYS`         | 7                     | Prune ended sessions after this many days.                                                                         |
| `FOLIO_AXI_DIAGNOSTIC_VIEWPORTS`         | all                   | Viewport classes the layout inbox tracks.                                                                          |

Attachment, export and share limits, and every other detail of the review page and server, are in the [reference](docs/reference.md).

## Language

The review page and annotation card default to Vietnamese. **English** in the More menu (⋮) switches them in place, including an open card, and the item then offers **Tiếng Việt** to switch back. The browser remembers the choice in `localStorage` (`folio-axi:language`), and a draft is untouched by the switch. CLI output and Folio's messages sent to the agent stay in English. If the card cannot receive the language or its localizer fails, it stays in English.

## Commands

| Command                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `folio-axi`                    | Show current sessions and usage guidance.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `folio-axi update`             | Folio is not on npm, so it does not update itself: prints the checkout to update (`git pull`, then `pnpm run build`). It never contacts the npm registry.                                                                                                                                                                                                                                                                                                                                  |
| `folio-axi <html-file>`        | Open or resume a Folio session, with the open-time layout gate enabled by default. Unresolved layout issues from earlier in the session are preserved. While its ended record exists, refuses to reopen a session the user explicitly ended from the browser unless `--reopen` is passed.                                                                                                                                                                                                  |
| `folio-axi poll <html-file>`   | Long-poll until the user sends feedback, ends the session, or leaves every review disconnected past `FOLIO_AXI_DISCONNECT_GRACE_MS` when that is set; detected layout issues arrive only when queued. On `browser_disconnected`, ask before reopening or ending the still-resumable session. On `ended`, stop polling and do not reopen uninvited.                                                                                                                                         |
| `folio-axi reply <html-file>`  | Post an agent reply and exit 0 only after the server accepts it, so the review page stops showing Working. Exits non-zero if the server does not confirm within 10 seconds. Use this when handing a result back without starting a long-poll. On a session the user ended (**Send & End**) the reply is added to the ended page and the session stays ended; a session the agent ended itself still refuses with `SESSION_ENDED`. `poll --agent-reply` still posts a reply and then waits. |
| `folio-axi end <html-file>`    | End a session as the agent; unlike a user-initiated end from the browser, this still allows a plain reopen later.                                                                                                                                                                                                                                                                                                                                                                          |
| `folio-axi export <html-file>` | Write a portable copy of the artifact: one HTML file with its local assets inlined, so it opens with no server and no sibling files. Remote CDN/font references are left as links.                                                                                                                                                                                                                                                                                                         |
| `folio-axi share <html-file>`  | Publish the artifact (local assets inlined) to [ht-ml.app](https://ht-ml.app), a third-party host not part of Folio, and print a visitable URL plus a secret update key; shares are public by default, `--private` locks one behind a generated password, and the same command republishes or unpublishes an existing page with `--site`/`--update-key`.                                                                                                                                   |
| `folio-axi stop`               | Shut down the background server. Polls still waiting reconnect, and start it again after about 8 seconds if nothing else has.                                                                                                                                                                                                                                                                                                                                                              |
| `folio-axi playbook [id]`      | List focused artifact guidance or show one playbook; agents must open each matching playbook before writing HTML.                                                                                                                                                                                                                                                                                                                                                                          |
| `folio-axi libraries`          | List the Excalidraw libraries in the whiteboard library directory; `--search <text>` or `--library <id>` lists item refs for `%% lavish-icon` nodes.                                                                                                                                                                                                                                                                                                                                       |
| `folio-axi design`             | Show agent-facing design guidance, including optional CDN snippets and the whiteboard (Mermaid) opt-in snippet.                                                                                                                                                                                                                                                                                                                                                                            |
| `folio-axi setup hooks`        | Preview Claude Code hooks; add `--write` to merge them into settings and restart the session.                                                                                                                                                                                                                                                                                                                                                                                              |
| `folio-axi server`             | Run the local Folio server.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Known playbook IDs: `diagram`, `table`, `comparison`, `plan`, `code`, `input`, `explanation`, `slides`.
One artifact often combines several playbooks, such as a plan that includes a comparison and a diagram, so agents must match against each `use_when` trigger and open every matching playbook before writing HTML.
For flows, architecture, state, or sequence diagrams, open the diagram playbook for the recommended tooling and SVG guidance.

### Flags

| Command                 | Flag                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folio-axi <html-file>` | `--no-open`                 | Ensure the server/session exists without opening another browser window.                                                                                                                                                                                                                                                                                                                                                              |
| `folio-axi <html-file>` | `--no-gate`                 | Skip the open-time layout curtain for this browser open.                                                                                                                                                                                                                                                                                                                                                                              |
| `folio-axi <html-file>` | `--reopen`                  | Reopen a session the user explicitly ended from the browser; while the ended record exists, a plain open without it refuses and explains why.                                                                                                                                                                                                                                                                                         |
| `folio-axi export`      | `--out <path>`              | Write the export to a specific path instead of `<name>.export.html` next to the source.                                                                                                                                                                                                                                                                                                                                               |
| `folio-axi share`       | `--private`                 | Make the page private behind a password Folio generates and returns once; hand it to viewers as a shared secret.                                                                                                                                                                                                                                                                                                                      |
| `folio-axi share`       | `--password <pw>`           | Make the third-party ht-ml.app page private with a password you supply; viewers must supply the password. An empty or whitespace-only value (an unquoted `$PW` that is unset) is refused rather than publishing a public page.                                                                                                                                                                                                        |
| `folio-axi share`       | `--site <site_id>`          | Republish an existing page in place (with `--update-key`) instead of creating a new one; the URL does not change.                                                                                                                                                                                                                                                                                                                     |
| `folio-axi share`       | `--update-key <key>`        | The secret returned when the page was published; required to republish or unpublish it.                                                                                                                                                                                                                                                                                                                                               |
| `folio-axi share`       | `--unpublish`               | Replace a published page with a locked placeholder (ht-ml.app cannot delete); takes `--site` and `--update-key` and no file.                                                                                                                                                                                                                                                                                                          |
| `folio-axi share`       | `--token <t>`               | Attach an optional bearer token (`FOLIO_AXI_HTML_APP_TOKEN`) when creating a page; never required, and rejected on a republish or `--unpublish`, where the `update_key` is the credential.                                                                                                                                                                                                                                            |
| `folio-axi poll`        | `--owner <label>`           | Identify the process listening for this session; the non-empty label appears in the home session listing. `none` is reserved for sessions without a listener. A second concurrent poll is refused instead of silently returning `waiting`.                                                                                                                                                                                            |
| `folio-axi poll`        | `--takeover`                | Explicitly displace the current poll listener. The displaced poll exits with typed `LISTENER_REPLACED`; without this flag, the new poll fails with typed `LISTENER_ACTIVE`, except that a waiting poll from the same agent session (`FOLIO_SESSION_ID`) replaces that session's older poll, which exits 0 with status `superseded`. A waiting poll whose server restarts reconnects on its own (up to 10 attempts, about 40 seconds). |
| `folio-axi poll`        | `--agent-reply "..."`       | Show a concise agent reply in the existing browser chat, conclude delivered work (every note the agent has seen is marked Done), and return presence to waiting before polling again. Keep replies concise by default.                                                                                                                                                                                                                |
| `folio-axi poll`        | `--agent-reply-file <path>` | When a longer reply is genuinely necessary, read Markdown from a file (`-` for stdin) so newlines survive quoting. Use blank-line paragraphs, `- ` / `1. ` lists, and `## ` headings so the Conversation panel renders it scannably. The Markdown subset is under Agent replies in How it works. Cannot be combined with `--agent-reply`.                                                                                             |
| `folio-axi poll`        | `--timeout-ms <ms>`         | Test/debug escape hatch only; agents should normally omit it and leave the long poll running.                                                                                                                                                                                                                                                                                                                                         |
| `folio-axi reply`       | `--agent-reply "..."`       | Concise reply text. Required unless `--agent-reply-file` is set. The command exits 0 only after the server accepts it. Empty text is refused. Prefer this over `poll --agent-reply` when you are not about to long-poll.                                                                                                                                                                                                              |
| `folio-axi reply`       | `--agent-reply-file <path>` | Read the reply from a file (`-` for stdin) so newlines survive quoting. Cannot be combined with `--agent-reply`. Same Markdown guidance as `poll --agent-reply-file`.                                                                                                                                                                                                                                                                 |
| `folio-axi stop`        | `--port <port>`             | Shut down a server running on a non-default port.                                                                                                                                                                                                                                                                                                                                                                                     |
| `folio-axi server`      | `--verbose`                 | Log session and watcher events to stderr; can also be enabled with `FOLIO_AXI_DEBUG=1`. Detached server output is appended with UTC timestamps to `~/.folio-axi/server.log` (or `FOLIO_AXI_STATE_DIR/server.log`) for startup, shutdown-cause, and crash diagnostics.                                                                                                                                                                 |
| `folio-axi server`      | `--also-listen <host>`      | Also listen on this concrete address (repeatable). The CLI passes it when it replaces a running server, so the replacement keeps every address the old one served; see [One server per port](docs/reference.md#one-server-per-port).                                                                                                                                                                                                  |

## Telemetry

Folio sends no telemetry.

## Development

```sh
pnpm run check          # Run all verification commands
pnpm run build          # Bundle the publishable CLI, chrome, and design assets
pnpm run build:skill    # Regenerate the installable folio skill
pnpm test               # Run node:test tests
pnpm run lint           # Run ESLint
pnpm run format:check   # Check Prettier formatting
pnpm run typecheck      # Run TypeScript checkJs validation
```

<!-- prettier-ignore-start -->

<!-- support:start -->
## Support the project

<p align="center">
  <img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/banner-v2.svg" width="560" alt="Built and maintained by one person in Việt Nam">
</p>

<p align="center">Free and open source. Your support pays for new device support, faster fixes and every release.</p>

<p align="center">
  <a href="https://buymeacoffee.com/ngoviet"><img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/btn-coffee.svg" height="56" alt="Buy me a coffee"></a>
  &nbsp;
  <a href="https://github.com/sponsors/ngoviet"><img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/btn-sponsors.svg" height="56" alt="GitHub Sponsors"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/vietqr-card.svg" width="300" alt="VietQR — MB Bank — NGO DUC VIET — 911051212">
  &nbsp;
  <img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/crypto-card.svg" width="300" alt="Crypto — BNB Smart Chain (BEP20) — 0xcbf0402b232cb24b4d998f09a4884f87b5f74750">
</p>

<p align="center"><b>Crypto wallet, BNB Smart Chain (BEP20) only:</b><br><code>0xcbf0402b232cb24b4d998f09a4884f87b5f74750</code></p>

<p align="center">🇻🇳 VietQR: scan with any Vietnamese banking app, transfer note <code>Ung ho folio-axi</code>. Thank you for keeping this project alive!</p>
<!-- support:end -->

<!-- prettier-ignore-end -->

## License

[MIT](LICENSE) © 2026 Kun Chen (lavish-axi). Folio's changes by Ngô Đức Việt are released under the same license.
