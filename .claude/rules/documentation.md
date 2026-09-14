---
paths:
  - "**/*.md"
  - "**/*.mdx"
  - "**/docs/**"
  - "**/README*"
---

# Documentation Conventions

- Code should be self-documenting through clear naming and structure. Comments explain *why*, not *what*.
- Public interfaces (functions, APIs, modules) need docstrings or doc comments — describe purpose, parameters, return values, and notable edge cases.
- Every project has a README: what it does, how to set it up, how to run it, how to deploy it.
- Document architectural decisions that aren't obvious — use ADRs (Architecture Decision Records) or a similar format for significant choices.
- Keep documentation next to the code it describes. Stale docs in a wiki nobody checks are worse than no docs.
