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

export interface ValidatedRepositoryInput {
  repositoryUrl: string;
  branch: string;
}

export function validateRepositoryInput(
  repositoryUrlRaw: unknown,
  branchRaw: unknown,
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

  return { repositoryUrl: parsed.toString(), branch };
}
