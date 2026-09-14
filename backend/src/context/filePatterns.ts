// Repository filter rules (spec section 4): what never reaches the AI at
// all, what is excluded from content but still listed, and what gets
// priority when we're picking which files to read given a limited budget.

const EXCLUDED_DIR_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".turbo",
  "bin",
  "obj",
]);

const BINARY_OR_ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".avif",
  ".svg", ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp3", ".mp4", ".mov", ".avi", ".webm", ".wav",
  ".exe", ".dll", ".so", ".dylib", ".class", ".jar", ".wasm", ".bin",
  ".pyc", ".o", ".a",
]);

// Secret-bearing files must never be listed or sent, regardless of any
// other rule.
const SECRET_FILE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)id_rsa(\.pub)?$/i,
  /credentials\.json$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /(^|\/)secrets?\.(ya?ml|json|toml)$/i,
];

const PRIORITY_FILENAME_PATTERNS: RegExp[] = [
  /(^|\/)readme(\.[a-z0-9]+)?$/i,
  /(^|\/)claude\.md$/i,
  /(^|\/)package\.json$/i,
  /(^|\/)requirements.*\.txt$/i,
  /(^|\/)pyproject\.toml$/i,
  /(^|\/)pom\.xml$/i,
  /(^|\/)dockerfile([.-].*)?$/i,
  /(^|\/)docker-compose.*\.ya?ml$/i,
  /(^|\/)\.github\/workflows\/.*\.ya?ml$/i,
  /(^|\/)\.gitlab-ci\.ya?ml$/i,
  /(^|\/)go\.mod$/i,
  /(^|\/)cargo\.toml$/i,
];

const PRIORITY_DIR_SEGMENTS = new Set([
  "src",
  "app",
  "backend",
  "frontend",
  "api",
  "services",
  "models",
  "agents",
  "prompts",
  "tests",
  "test",
  "workflows",
]);

function segments(relPath: string): string[] {
  return relPath.split("/").filter(Boolean);
}

function extensionOf(relPath: string): string {
  const idx = relPath.lastIndexOf(".");
  return idx === -1 ? "" : relPath.slice(idx).toLowerCase();
}

export function isSecretFile(relPath: string): boolean {
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(relPath));
}

export function isExcludedDir(relPath: string): boolean {
  return segments(relPath).some((segment) => EXCLUDED_DIR_SEGMENTS.has(segment));
}

export function isBinaryOrAsset(relPath: string): boolean {
  return BINARY_OR_ASSET_EXTENSIONS.has(extensionOf(relPath));
}

/** True if the file should be excluded from the repository context entirely. */
export function isExcludedFromContext(relPath: string): boolean {
  return isSecretFile(relPath) || isExcludedDir(relPath) || isBinaryOrAsset(relPath);
}

export function isPriorityFile(relPath: string): boolean {
  if (PRIORITY_FILENAME_PATTERNS.some((pattern) => pattern.test(relPath))) return true;
  return segments(relPath).some((segment) => PRIORITY_DIR_SEGMENTS.has(segment));
}
