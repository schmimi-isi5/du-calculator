# Version Control

## Commits & Branching

- Use Conventional Commits (`type(scope): description`) — it keeps history searchable and enables automated changelogs.
- Keep commits atomic: one logical change per commit. It makes reverts safe and reviews fast.
- Branch naming: `<type>/<ticket-id>-<short-description>` (e.g., `feat/PROJ-42-user-auth`). Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`.
- Rebase feature branches onto the target branch before merging — linear history is easier to reason about.
- Never force-push to shared branches (`main`, `develop`, release branches).
- Commit lock files. Don't commit build artifacts.

## Pull Requests & Review

- Keep PRs small and focused — if a review takes more than 30 minutes, the PR is too big.
- Every PR needs a description: what changed, why, and how to verify.
- Link the relevant ticket or issue — context shouldn't live only in someone's head.
- All CI checks must pass before merge. No exceptions, no "I'll fix it in the next PR."
- At least one approval required. Reviewers check for correctness, clarity, and adherence to conventions.
- Review the logic and intent, not just the syntax. A passing test suite doesn't mean the approach is right.
- Merge strategy depends on PR shape: squash merge small, single-purpose PRs into one commit; use a merge commit for larger or multi-commit feature branches where the individual commits carry useful history.
