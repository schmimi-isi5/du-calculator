# Security Conventions

- Never commit secrets, tokens, API keys, or credentials. Use environment variables or a secrets manager.
- Validate and sanitize all external input — user input, API payloads, query parameters, file uploads. Trust nothing from outside the system boundary.
- Apply the principle of least privilege everywhere: service accounts, database users, API scopes, file permissions.
- Encrypt sensitive data at rest and in transit. Use TLS. No exceptions.
