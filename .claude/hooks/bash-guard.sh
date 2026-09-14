#!/usr/bin/env bash
# PreToolUse guard: blocks direct pushes/commits to master/main, and shell reads of .env secrets.
# Reads the hook JSON payload from stdin (provided by Claude Code's hook runner).
# Outputs a deny decision JSON on match; exits 0 silently otherwise.

cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -z "$cmd" ] && exit 0
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}' "$1"
  exit 0
}

# Block explicit push targeting master or main (any remote, any refspec form)
if echo "$cmd" | grep -Eq 'git[[:space:]]+push[[:space:]]+[^|&]*\b(master|main)\b' || \
   echo "$cmd" | grep -Eq ':(master|main)\b'; then
  deny "Direct push to master/main is blocked. Use a feature branch and open a PR."
fi

# Block implicit push or commit while HEAD is master/main
if [ "$branch" = "master" ] || [ "$branch" = "main" ]; then
  if echo "$cmd" | grep -Eq 'git[[:space:]]+push'; then
    # Count non-flag tokens after 'git push' to detect bare/single-remote pushes
    after="${cmd#*push }"
    nonflag=0
    for token in $after; do
      case "$token" in -*) ;; *) nonflag=$((nonflag + 1)) ;; esac
    done
    [ "$nonflag" -lt 2 ] && deny "Direct push from master/main is blocked. Use a feature branch and open a PR."
  fi
  if echo "$cmd" | grep -Eq 'git[[:space:]]+commit'; then
    deny "Committing directly to master/main is blocked. Create a feature branch first."
  fi
fi

# Block shell reads of .env files (supplements the Read-tool deny rules)
if echo "$cmd" | grep -Eiq '(cat|less|more|head|tail|nano|vi|vim|strings|xxd|od)[[:space:]]+[^|]*\.env(\.|[[:space:]]|$)'; then
  deny "Reading .env files is blocked to protect secrets."
fi

exit 0
