#!/usr/bin/env bash
# PreToolUse guard: blocks Write/Edit when HEAD is master/main.
# Enforces the branch-before-edit workflow for AI sessions.
# No stdin parsing needed — the check is purely on the current branch.

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

if [ "$branch" = "master" ] || [ "$branch" = "main" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"You are on %s. Create a feature branch first: git checkout -b <type>/<description>"}}' "$branch"
  exit 0
fi

exit 0
