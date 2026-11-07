---
title: GitHub Action
description: Comment on every pull request with how its diagrams changed — DSL diff, node counts, drift and stale SVGs — from your own CI.
---

The PR diagrams Action posts one comment on a pull request that changes a diagram file. It runs
in your CI with the [`openflowkit` CLI](/cli/), `git` and `gh`: no server and no hosting.

## Set it up

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

Use a release tag (`v2.1.0` or later) or a commit SHA. A branch name also works but moves
under you. Inside the OpenFlowKit repository itself, `uses: ./action` works.

The default CLI is the version pinned in that tag's `action.yml`: 0.2.3 in
`v2.1.0`, `0.2.5` from the next release. A CLI you point the `cli` input at must be 0.2.0 or
newer: older versions have no `render`, `convert` or `op`.

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Comments, and pushes refreshed SVGs |
| `cli` | `npx -y openflowkit@<pinned>` (0.2.3 in `v2.1.0`) | The command that runs the CLI; it never sees the token |
| `refresh-svg` | `false` | Commit a fresh `<name>.svg` when the committed one is stale (same-repo PRs only) |
| `comment-author` | `github-actions[bot]` | The login whose comment is updated; set it when you pass a PAT or App token |
| `paths` | `.openflow.json,.ofk` | Extensions (starting with `.`) or globs, comma-separated |

## What it posts

One comment per pull request, updated in place. For each changed diagram: its status, node
and connector counts before and after, the DSL diff (first 300 lines) and, for `.ofk`
architecture models, drift (gone, new, changed). A file that fails to render gets a line, not
a failed job. When no diagram changed, there is no comment.

A committed SVG beside a diagram (`x.openflow.json` or `x.ofk` next to `x.svg`) that differs
from a fresh render is listed as stale. With `refresh-svg: true` on a same-repo PR, the Action
commits the fresh SVG to the PR branch instead, and still lists it if the push is rejected.

## Forks and branch protection

Fork and Dependabot PRs get a read-only token, so the Action can't comment or push there. It
writes the same text to the job summary and exits 0. It does the same if the comment call
returns 403.

A push made with `GITHUB_TOKEN` doesn't trigger workflows, so a refreshed commit has no checks
and required checks block the merge. That is why `refresh-svg` is off by default. To use it
under branch protection, pass an App or PAT token as `github-token`, and its login as
`comment-author`.

## What it does not do

- **No inline images.** GitHub can't show an SVG from CI without hosting it. The before and
  after SVGs are uploaded as the run's `diagram-svgs` artifact (kept 14 days), and the comment
  links to it.
- **No PNG.** Pictures are SVG, like the CLI's.

## Where to go next

- [The openflowkit CLI](/cli/): the commands the Action runs.
- [Architecture workspace](/architecture-workspace/): `.ofk` models and drift.
