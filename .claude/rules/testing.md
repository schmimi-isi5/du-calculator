---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/*_test.*"
  - "**/test/**"
  - "**/tests/**"
  - "**/__tests__/**"
---

# Testing Conventions

- New features require tests. Bug fixes require a regression test that would have caught the bug.
- Test behavior, not implementation — tests should survive refactors without rewriting.
- Use descriptive test names that read like specifications (e.g., "returns 404 when the resource does not exist").
- Keep tests independent — no shared mutable state between test cases. Each test sets up what it needs and cleans up after.
- Aim for meaningful coverage, not a vanity percentage. 80% coverage with thoughtful tests beats 100% with trivial ones.
- Mock at the boundary (external services, I/O), not in the middle of your own code.
