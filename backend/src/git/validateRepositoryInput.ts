// Input validation for user-supplied git repository coordinates.
//
// simple-git invokes git via execFile (argv array, not a shell string), so
// this is not a shell-injection guard by itself - it exists to reject
// malformed input early with a clear error, and to block git flag injection
// (a branch name starting with "-" being read as an option) and obvious
// SSRF targets (localhost / private network ranges) before we ever spawn
// git.

export class InvalidRepositoryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRepositoryInputError";
  }
}

const BRANCH_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,199}$/;

// Deliberately coarse: literal hostname/IP prefixes for loopback, RFC1918
// private ranges, and link-local (which covers cloud metadata endpoints like
// 169.254.169.254). This does not defend against DNS rebinding - see
// GitRepositoryService for the accompanying note.
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
];

const MAX_ACCESS_TOKEN_LENGTH = 512;
// Tokens never legitimately contain whitespace/control characters; reject
// them outright rather than letting oddities flow into a URL.
const ACCESS_TOKEN_PATTERN = /^[\x21-\x7e]+$/;

export interface ValidatedRepositoryInput {
  repositoryUrl: string;
  branch: string;
  /** Present only when the caller supplied one - see AccessToken rules below. */
  accessToken?: string;
}

export function validateRepositoryInput(
  repositoryUrlRaw: unknown,
  branchRaw: unknown,
  accessTokenRaw?: unknown,
): ValidatedRepositoryInput {
  if (typeof repositoryUrlRaw !== "string" || repositoryUrlRaw.trim().length === 0) {
    throw new InvalidRepositoryInputError("repositoryUrl is required.");
  }
  if (typeof branchRaw !== "string" || branchRaw.trim().length === 0) {
    throw new InvalidRepositoryInputError("branch is required.");
  }

  const branch = branchRaw.trim();
  if (!BRANCH_PATTERN.test(branch)) {
    throw new InvalidRepositoryInputError(
      "branch contains invalid characters. Allowed: letters, digits, '.', '_', '-', '/'.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(repositoryUrlRaw.trim());
  } catch {
    throw new InvalidRepositoryInputError("repositoryUrl must be a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new InvalidRepositoryInputError(
      "repositoryUrl must use http or https. SSH/file/other protocols are not supported in this MVP.",
    );
  }

  if (BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(parsed.hostname))) {
    throw new InvalidRepositoryInputError(
      "repositoryUrl points to a local or private network address, which is not allowed.",
    );
  }

  if (parsed.username || parsed.password) {
    throw new InvalidRepositoryInputError(
      "repositoryUrl must not contain embedded credentials. Use the accessToken field instead.",
    );
  }

  let accessToken: string | undefined;
  if (accessTokenRaw !== undefined && accessTokenRaw !== null && accessTokenRaw !== "") {
    if (typeof accessTokenRaw !== "string") {
      throw new InvalidRepositoryInputError("accessToken must be a string.");
    }
    const trimmed = accessTokenRaw.trim();
    if (trimmed.length === 0) {
      accessToken = undefined;
    } else if (trimmed.length > MAX_ACCESS_TOKEN_LENGTH || !ACCESS_TOKEN_PATTERN.test(trimmed)) {
      throw new InvalidRepositoryInputError("accessToken contains invalid characters or is too long.");
    } else {
      accessToken = trimmed;
    }
  }

  return { repositoryUrl: parsed.toString(), branch, accessToken };
}

/**
 * Builds the clone URL with the access token embedded as the HTTPS
 * username (the convention GitHub, GitLab, and most other hosts accept for
 * personal access tokens: `https://<token>@host/...`). The caller must use
 * this URL only for the git process invocation - never log it or return it
 * to the client. Pass the original, credential-free repositoryUrl for
 * anything user-facing (snapshots, logs, error messages).
 */
export function buildAuthenticatedCloneUrl(repositoryUrl: string, accessToken: string): string {
  const url = new URL(repositoryUrl);
  url.username = accessToken;
  return url.toString();
}
