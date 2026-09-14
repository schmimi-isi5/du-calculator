---
paths:
  - "**/package.json"
  - "**/*.lock"
  - "**/requirements*.txt"
  - "**/pyproject.toml"
  - "**/go.mod"
  - "**/Cargo.toml"
  - "**/Gemfile*"
  - "**/composer.json"
  - "**/pom.xml"
  - "**/build.gradle*"
---

# Dependency Management

- Pin dependency versions via lock files. Commit lock files to the repository.
- Evaluate before adding: does this dependency justify the long-term maintenance cost? Fewer dependencies mean fewer supply chain risks.
- Prefer well-maintained, widely adopted libraries. Check last commit date, issue activity, and bus factor before adopting.
- Separate production dependencies from development dependencies.
- Update dependencies regularly in small batches, not all at once in a panic after 6 months.
