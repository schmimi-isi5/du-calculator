# Shared CLAUDE.md Template

This repository contains the team's shared `CLAUDE.md` template — a starting point for every new project.

## What is CLAUDE.md?

`CLAUDE.md` is a conventions file that lives at the root of a project. It gives Claude (and developers) clear context about how the project works: its stack, structure, commands, and the conventions the team follows.

The file in this repo is a **template**. It captures our shared engineering principles, but it's designed to be adapted — not used as-is.

## Repository Layout

```
.
├── CLAUDE.md                          # Project-specific scaffolding (fill in per project)
├── .github/
│   └── workflows/
│       └── ci.yml                     # CI template — fill in per project
└── .claude/
    ├── rules/
    │   ├── naming-conventions.md      # always loaded
    │   ├── coding-conventions.md      # always loaded
    │   ├── git-version-control.md     # always loaded
    │   ├── pull-requests-code-review.md # always loaded
    │   ├── error-handling.md          # always loaded
    │   ├── logging.md                 # always loaded
    │   ├── security.md                # always loaded
    │   ├── testing.md                 # path-scoped: test files only
    │   ├── documentation.md           # path-scoped: .md / docs/ only
    │   ├── dependency-management.md   # path-scoped: manifests & lock files only
    │   └── environment-config.md      # path-scoped: .env / config files only
    ├── agents/                        # placeholder for custom agent definitions
    ├── commands/                      # placeholder for slash commands
    └── skills/                        # placeholder for reusable skills
```

### How rules load

Rules in `.claude/rules/` are loaded by Claude Code automatically:

- **Always-loaded rules** (no frontmatter) enter the context window at session start, alongside `CLAUDE.md`. They apply to every file and every session.
- **Path-scoped rules** (with a `paths:` YAML frontmatter block) load **only when Claude reads a file matching one of the listed glob patterns**. This keeps irrelevant conventions out of context and reduces noise.

For more detail see the [official `.claude/rules/` documentation](https://code.claude.com/docs/en/memory#organize-rules-with-claude-rules).

### Adapting path-scoped rules

The glob patterns in `testing.md`, `documentation.md`, `dependency-management.md`, and `environment-config.md` are **language-agnostic defaults**. When copying this template to a project, verify the patterns match your stack — remove patterns for ecosystems you don't use and add any missing ones. For example, a Python project would not need `**/Cargo.toml` in `dependency-management.md`.

## How to Use

1. **Copy** this repository's files to the root of your project (or copy just the files you need).
2. **Fill in the project-specific sections** in `CLAUDE.md`: Project Overview, Tech Stack, Project Structure, and Essential Commands.
3. **Review the shared conventions** in `.claude/rules/` and adjust anything that doesn't fit your project's needs. Some principles may need rewording, tightening, or relaxing depending on the stack, the domain, or the team.
4. **Adjust path-scoped glob patterns** in the four path-scoped rules files to match your project's layout and language ecosystem.
5. **Add project-specific conventions** either directly in `CLAUDE.md` or as new files in `.claude/rules/`.
6. **Commit everything** as part of your project's repository. From that point on, the project's copy is the source of truth for that repo.

## CI Template

`.github/workflows/ci.yml` ships as a scaffold with six standard jobs: **install → lint → format check → type check → test → build → dependency audit**. Every step is a placeholder (`echo "TODO: …"`) so CI is green out of the box before you fill anything in.

To adapt it for a project:
1. Uncomment the runtime setup step for your language (Node, Python, Go, Java, …).
2. Replace each `echo "TODO: …"` with the real command for your toolchain.
3. Remove steps that don't apply (e.g. type check for a plain JS project, build for a pure library).

## Branch Protection: Two Layers

This template enforces a branch-before-edit workflow at two levels — one for AI sessions, one for everyone else.

### Layer 1 — Claude Code hooks (AI sessions)

`.claude/settings.json` ships with two `PreToolUse` hooks:

| Hook script | Matcher | What it blocks |
|---|---|---|
| `bash-guard.sh` | `Bash` | `git commit` or `git push` targeting `main`/`master` |
| `branch-guard.sh` | `Write\|Edit` | Any file edit when `HEAD` is `main`/`master` |

Together they prevent Claude from writing a single file or committing before a branch exists. This is the AI layer.

> **Requirement:** both scripts use `jq` (for `bash-guard.sh`) and standard POSIX tools. Install `jq` if it is not already on your `PATH`.

### Layer 2 — GitHub branch protection (humans + all git pushes)

The Claude Code hooks only cover AI sessions. To protect against direct pushes from any developer:

1. Go to **Settings → Branches → Add branch protection rule**
2. Branch name pattern: `main` (or `master`)
3. Enable **Require a pull request before merging**
4. Enable **Require status checks to pass** (if you have CI)
5. Enable **Do not allow bypassing the above settings**

Both layers together mean no one — human or AI — can push directly to your default branch.

## The Right Mindset

This template gives you a head start, not a rigid rulebook. A `CLAUDE.md` and its rules are most useful when they're specific and honest about how a project actually operates. A generic copy-paste helps no one — take the time to make it yours.
