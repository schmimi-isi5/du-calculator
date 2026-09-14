---
description: Promote remote main to test, or remote test to prod, triggering the Coolify CD pipeline
argument-hint: [test|prod]
allowed-tools: Bash(git fetch:*), Bash(git log:*), Bash(git ls-remote:*), Bash(git push origin origin/main:*), Bash(git push origin origin/test:*)
disable-model-invocation: true
---

# Deploy

Promote one remote branch to the next environment: `main` → `test`, `test` → `prod`.
Remote-to-remote only — nothing local is ever pushed.

Target: `$ARGUMENTS`

## Context

- !`git fetch origin --prune`
- Tip of main: !`git log --oneline -3 origin/main`
- Tip of test: !`git log --oneline -3 origin/test`
- Env branches: !`git ls-remote --heads origin test prod`

## Rules

1. `$ARGUMENTS` must be exactly `test` or `prod`. Otherwise stop and output only:
   "Please specify: `/deploy test` or `/deploy prod`". Never guess or default.
2. Before pushing, state the commit being deployed and remind the user that local
   uncommitted work and unmerged branches are **not** included — only the remote
   source branch.
3. The refspec is always `origin/<source>:<target>`. Never push `HEAD` or a local
   branch. Never `checkout`, `merge`, `rebase`, or `commit`.

## test — source is `main`

```bash
git push origin origin/main:test
```

Then print: 🚀 Promoted remote `main` to `test`. Coolify is deploying.

## prod — source is `test`

1. Show what ships: `git log --oneline origin/prod..origin/test`. If empty, report
   prod is current and stop.
2. If `git log --oneline origin/test..origin/main` is non-empty, warn that test is
   behind main and name the commits that will **not** reach prod.
3. Ask "Promote remote `test` to production? (N commits above)" and **wait**. Only a
   clear yes proceeds; hedging, questions, or silence abort.
4. `git push origin origin/test:prod`
5. Then print: 🔥 Promoted remote `test` to `prod`. Coolify runner going live.

## On rejection

Non-fast-forward means the target branch has commits the source doesn't (direct
hotfix). Never `--force`. Show `git log --oneline origin/<source>..origin/<target>`,
report what would be lost, and only after explicit approval use `--force-with-lease`.

Any other git error: print it verbatim and stop.
