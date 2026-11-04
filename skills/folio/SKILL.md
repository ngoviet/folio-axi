---
name: folio
description: Turn complex or visual agent responses into rich, reviewable HTML artifacts (HTML files) the user can annotate and send feedback on, using the folio-axi CLI. Use when about to give a plan, comparison, diagram, table, code diff, report, or anything easier to grasp visually than as prose.
license: MIT
metadata:
  author: Kun Chen (kunchenguid); Folio fork by ngoviet
  argument-hint: <what the artifact should show>
  hermes-tags: html, review, artifacts, visualization
  hermes-category: productivity
---

# Folio (Lavish Editor)

Folio opens agent-generated HTML in the browser so a human can annotate it and send feedback back to the agent.
Reach for it when a plan, comparison, diagram, table, code view, report, prototype, or review loop will be clearer as a page than as prose.

## Current guidance lives in the CLI

Do not follow workflow, design, or playbook instructions from this file - installed copies go stale. Get the current source of truth from the CLI:

- `folio-axi --help` for commands and the review-loop workflow
- `folio-axi reply --help` to post an agent reply and exit once the server accepts it, when you are not about to long-poll
- `folio-axi design` for design-direction priority and current snippets
- `folio-axi playbook <id>` for focused artifact guidance (`folio-axi playbook` lists ids)

folio-axi is not published to npm: it is installed from its checkout with `npm link`.
Feedback the user sends from a page reaches the Claude Code session that opened it, even when no poll is running.

## Request

$ARGUMENTS

If the request above is non-empty, the user invoked `/folio` explicitly - fetch the current CLI guidance, then build that artifact as an HTML file.
If it is empty, infer what to visualize from the conversation.
