/**
 * Shared filesystem path-safety helpers.
 *
 * Project slugs and file paths cross trust boundaries (they arrive over the
 * WebSocket from the server, and slugs can be LLM-derived from user prompts).
 * These helpers are the single source of truth used by both the runner
 * (file/build command handlers) and the template downloader so the rules
 * cannot drift between call sites.
 *
 * Pure node:path only - safe to import from any context.
 */
import { resolve, relative, isAbsolute } from 'node:path';

// A slug becomes a workspace subdirectory name. We deliberately do NOT require
// a leading alphanumeric: the slug generator can emit leading hyphens for
// non-ASCII prompts (e.g. "日本語 todo" -> "-todo"), and such rows already
// exist. The real protection is the resolve/relative boundary check in
// resolveProjectPath - this pattern just rejects path separators, control
// characters, and absolute/Windows-drive forms cheaply and early.
const SLUG_PATTERN = /^[a-zA-Z0-9._-]+$/;
const MAX_SLUG_LENGTH = 128;

export function isValidProjectSlug(slug: unknown): slug is string {
  return (
    typeof slug === 'string' &&
    slug.length > 0 &&
    slug.length <= MAX_SLUG_LENGTH &&
    SLUG_PATTERN.test(slug) &&
    !slug.includes('..')
  );
}

export function assertValidProjectSlug(slug: unknown): asserts slug is string {
  if (!isValidProjectSlug(slug)) {
    throw new Error(`Invalid project slug: ${String(slug)}`);
  }
}

/**
 * Resolve a project directory inside the workspace root, guaranteeing the
 * result stays within the root (defends against traversal even if the slug
 * pattern is ever loosened).
 */
export function resolveProjectPath(workspaceRoot: string, slug: unknown): string {
  assertValidProjectSlug(slug);
  const root = resolve(workspaceRoot);
  const projectPath = resolve(root, slug);
  const rel = relative(root, projectPath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Invalid project slug: ${slug}`);
  }
  return projectPath;
}

/**
 * Predicate form for callers that don't have the project directory to resolve
 * against (e.g. the web API validating a path before forwarding it to the
 * runner). Rejects absolute paths, Windows drive paths, NUL bytes, and any
 * '..' traversal segment. The runner still re-validates authoritatively with
 * resolveWithinProject; this is fail-fast defense-in-depth that shares the rule.
 */
export function isSafeRelativePath(relPath: unknown): relPath is string {
  if (typeof relPath !== 'string' || relPath.length === 0 || relPath.includes('\0')) {
    return false;
  }
  if (relPath.startsWith('/') || relPath.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(relPath)) return false;
  return !relPath.split(/[\\/]/).some(segment => segment === '..');
}

/**
 * Resolve a relative file path inside an already-validated project directory,
 * rejecting anything that escapes the project (../, absolute paths, the
 * project root itself, or NUL bytes).
 */
export function resolveWithinProject(projectPath: string, relPath: unknown): string {
  if (typeof relPath !== 'string' || relPath.length === 0 || relPath.includes('\0')) {
    throw new Error(`Invalid file path: ${String(relPath)}`);
  }
  const fullPath = resolve(projectPath, relPath);
  const rel = relative(projectPath, fullPath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Invalid file path - outside project directory');
  }
  return fullPath;
}
