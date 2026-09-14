---
paths:
  - "**/.env*"
  - "**/config/**"
  - "**/*.ini"
  - "**/*.yaml"
  - "**/*.yml"
---

# Environment & Configuration

- All configuration must be injectable via environment variables — no hardcoded URLs, ports, feature flags, or credentials.
- Provide a `.env.example` in every project with every required variable documented. A new developer should be able to `cp .env.example .env`, fill in the blanks, and run.
- Use `.env` files for local development only — never for staging or production.
- Separate configuration from code. If a value could change between environments, it's configuration.
- Fail fast on missing required configuration at startup — don't wait until the first request hits a `nil` config value.
