---
description: Interview me about this project, then fill CLAUDE.md and write docs/PRD.md — no code
argument-hint: [one-line description of the project]
---

Kickoff for a new repo from `claude-code-config-template`. Produce two files: a filled-in
`CLAUDE.md` and `docs/PRD.md`. Write no application code this session.

Pitch: $ARGUMENTS

## 1. Read first

Check `CLAUDE.md`, `README.md`, `docs/`, `.claude/rules/`, and any stack config
(`package.json`, `pyproject.toml`, `go.mod`, `Dockerfile`, CI workflows).
Anything you can read is already decided — state it as an assumption, don't ask.

If `CLAUDE.md` already has real content, this is a re-run: interview only the gaps or what
changed, then show a diff and confirm before writing.

## 2. Interview

Ask **one question at a time** and wait for the answer. Never send a numbered list —
batched questions get skimmed.

- Propose instead of asking: "I'd default to Postgres, any reason not to?" beats
  "which database?"
- Reject vague answers. "Fast", "scalable", "handles a lot of data" — ask for the number,
  the user, the failure case.
- Spend questions on what they haven't thought about: failure modes, who else touches this,
  what it must NOT do.
- 8–15 questions. Stop early once answers stop changing your understanding.

Cover: problem and users · v1 scope and non-goals · success criteria · stack · data model ·
interfaces and auth · deployment and config · constraints · failure handling · testing.

## 3. Structure

Follow the established convention for the stack — Next.js App Router, Django project/apps,
`golang-standards/project-layout`, Python `src/`, Maven, Rails. Use the official scaffolding
tool's output as the baseline (`create-next-app`, `django-admin startproject`, `cargo new`).
Group by feature, not by file type. Match our existing repos where they've settled a
question. Never invent a layout; name the convention you followed.

## 4. Fill CLAUDE.md

Replace the TODO blocks, keep the headings and the `.claude/rules/` comment.

- Operational content only, under ~100 lines. This file loads on every prompt.
- **Project Overview**: name, one-line description, who it serves. Then:
  `Product context and decisions: see docs/PRD.md — read when scope or requirements are in question.`
- **Project Structure**: tree with a short note per directory, plus the convention name.
- **Essential Commands**: verify each against the `justfile` recipes, `package.json`, or
  scaffolding defaults. Where a recipe exists, list the `just <recipe>` form rather than the
  underlying tool command. Mark unknowns `TODO` — a wrong command gets run.
- **Project-Specific Conventions**: only what's specific to this project. Team-wide rules
  live in `.claude/rules/`; don't duplicate them.
- Never invent content to fill a heading. Undecided → `TODO: see docs/PRD.md open questions`.

## 5. Write docs/PRD.md

Sections: Problem · Users · Scope (v1) · Non-goals · Success criteria ·
Decisions (table: decision / rationale / alternatives rejected) · Open questions.

Head it with `Status: Draft — pending review by <author>` using `git config user.name`.
Record only what you were told or confirmed. Include the Step 3 structure decision.
Guesses go in Open questions, never in Decisions.

## 6. Hand off

Summarise what you captured, flag anything uncertain, and tell the developer to read and
edit both files before any code is written.

Then **stop**. Do not implement, scaffold, or write boilerplate — even if the next step is
obvious. An unreviewed generated plan reads as authoritative while being wrong in ways
nobody has checked.
