# Contributing

Thanks for wanting to contribute.
One rule up front:

**Human-authored pull requests targeting `main` must be raised through [`no-mistakes`](https://github.com/kunchenguid/no-mistakes).**
We require this to reduce the maintainer's burden of reviewing and merging contributions.

`no-mistakes` puts a local git proxy in front of your real remote.
Pushing through it runs an AI-driven review/test/lint pipeline in an isolated worktree, forwards the push upstream only after every check passes, and opens a clean PR automatically.

CI runs on the self-hosted Woodpecker pipeline in `.woodpecker/ci.yaml`; this repository does not use GitHub Actions.

## Workflow

1. Create a branch and make your changes.
2. Commit your changes.
3. Push through the configured gate instead of pushing directly:

   ```sh
   git push no-mistakes
   ```

4. Run `no-mistakes` to attach to the pipeline, watch findings, and auto-fix or review as needed.

See the [no-mistakes quick start](https://kunchenguid.github.io/no-mistakes/start-here/quick-start/) for the full first-run walkthrough.

## Repo Conventions

- Node 22+, ESM-only JavaScript, and TypeScript `checkJs` validation.
- Run `pnpm run check` before pushing.
- Do not reformat repo-provided `.agents/` skill content; `.prettierignore` excludes it intentionally.
- `CHANGELOG.md` is upstream history through 0.1.96; record Folio changes in [docs/folio/README.md](docs/folio/README.md).

## Questions

Open an issue, or talk to me on [Discord](https://discord.gg/Wsy2NpnZDu).
