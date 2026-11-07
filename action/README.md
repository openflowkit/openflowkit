# OpenFlowKit PR diagrams

A GitHub Action that comments on a pull request with how its diagrams changed. It runs in your CI: no server, no hosting. Uses the `openflowkit` CLI, `git` and `gh`.

```yaml
on:
  pull_request:
    paths: ['**/*.openflow.json', '**/*.ofk']
permissions:
  contents: write        # only to push refreshed SVGs
  pull-requests: write   # the comment
jobs:
  diagrams:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: openflowkit/openflowkit/action@v2.1.0
```

Use a release tag (`v2.1.0` or later) or a commit SHA; a branch name works but moves under you. Inside this repository, `uses: ./action` works too.

## Inputs

| Input | Default | |
|---|---|---|
| `github-token` | `${{ github.token }}` | comments and pushes |
| `cli` | `npx -y openflowkit@<pinned>` (0.2.3 in `v2.1.0`) | command that runs the CLI (the CLI never sees the token) |
| `refresh-svg` | `false` | refresh a stale committed `<name>.svg` on same-repo PRs |
| `comment-author` | `github-actions[bot]` | login whose comment is updated (set it when using a PAT or App token) |
| `paths` | `.openflow.json,.ofk` | extensions (start with `.`) or globs, comma-separated |

## Requirements

The default `cli` is the version pinned in that tag's `action.yml`: 0.2.3 in `v2.1.0`, 0.3.0 in `v2.2.0`. Any CLI you point `cli` at must be at least 0.2.0: older ones lack `render`, `convert` and `op`.

## What it posts

One comment per PR, updated in place (hidden marker `<!-- openflowkit-pr-diagrams -->`). Per changed diagram: status, node and connector counts before and after, the DSL diff (first 300 lines), and drift (gone, new, changed) for `.ofk` architecture models. A file that fails to render gets a line, not a crash. No diagram changed: no comment.

A committed SVG beside a diagram (`x.openflow.json` or `x.ofk` and `x.svg`) that differs from a fresh render is listed as stale in the comment. With `refresh-svg: true` on a same-repo PR it is refreshed with a commit to the PR branch instead (and still listed if the push is rejected).

## Forks and branch protection

Fork and Dependabot PRs get a read-only token, so the action cannot comment or push there: it writes the same body to the job summary (`$GITHUB_STEP_SUMMARY`) and exits 0. The same happens if the comment call returns 403.

A refresh push made with `GITHUB_TOKEN` does not trigger workflows, so the new head commit has no checks and required checks block the merge. That is why it is off by default; to turn it on under branch protection, pass an App or PAT token as `github-token` (and its login as `comment-author`).

## Limitation

Images are not shown inline: GitHub cannot render an SVG from CI without hosting it. Before/after SVGs are uploaded as the `diagram-svgs` artifact of the run, and the comment links to it.

`--dry-run` (`node pr-diagrams.mjs --dry-run`) prints the comment and never calls `gh`, commits or pushes.
