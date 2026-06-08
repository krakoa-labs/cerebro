import { spawnSync } from "node:child_process";

/**
 * Detects whether a directory is tracked by git by asking git itself whether
 * the path sits inside a work tree. Returns `false` for any failure — a path
 * outside a repository, or git not being installed — so callers get a plain
 * boolean with no error to handle.
 *
 * @param cwd - The directory to check.
 * @returns `true` when `cwd` is inside a git work tree, `false` otherwise.
 */
export function detectGitRepo(cwd: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    encoding: "utf8",
  });

  return result.status === 0 && result.stdout.trim() === "true";
}

export interface GitAvailability {
  available: boolean;
  shallow: boolean;
}

/**
 * Inspects the git state of a directory: whether it sits inside a git work
 * tree, and — when it does — whether that repository is a shallow clone whose
 * history is truncated.
 *
 * @param cwd - The directory to inspect.
 * @returns The git availability. `available` is `false`, and `shallow` is then
 *   also `false`, when `cwd` is outside a repository or git is unavailable.
 */
export function inspectGit(cwd: string): GitAvailability {
  const available = detectGitRepo(cwd);
  return { available, shallow: available && detectShallowRepo(cwd) };
}

/**
 * Detects whether the git repository containing a directory is a shallow
 * clone — one fetched with a truncated history via `--depth`.
 *
 * @param cwd - A directory inside the repository to check.
 * @returns `true` when the repository is shallow, `false` otherwise.
 */
function detectShallowRepo(cwd: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-shallow-repository"], {
    cwd,
    encoding: "utf8",
  });

  return result.status === 0 && result.stdout.trim() === "true";
}

/** Separates the fields within a single `git log` record. */
const FIELD_SEPARATOR = "\x1f";

export interface ActivityLogEntry {
  sha: string;
  committedAt: string;
  authorName: string;
  authorEmail: string;
  subject: string;
}

/**
 * Reads the most recent commits that touched a path, newest first, as a
 * Component's raw activity log. Each entry carries the commit's full SHA, its
 * committer date (strict ISO 8601), the author's name and email, and the
 * subject line.
 *
 * @param cwd - The directory git runs in — the design system root.
 * @param scope - The path, relative to `cwd`, whose history to read.
 * @param depth - The maximum number of commits to return.
 * @returns The commits touching `scope`, newest first, capped at `depth`.
 *   Empty when the path has no commits or git could not produce a log.
 */
export function readActivityLog(cwd: string, scope: string, depth: number): ActivityLogEntry[] {
  const format = ["%H", "%cI", "%an", "%ae", "%s"].join(FIELD_SEPARATOR);
  const result = spawnSync(
    "git",
    ["log", "-z", `--max-count=${depth}`, `--pretty=format:${format}`, "--", scope],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) return [];

  return result.stdout.split("\0").flatMap((record) => {
    const entry = parseLogRecord(record);
    return entry === null ? [] : [entry];
  });
}

/**
 * Parses one NUL-delimited `git log` record into an activity log entry. The
 * subject is rejoined from the trailing fields so a separator character inside
 * a commit subject cannot truncate it.
 *
 * @param record - A single record of field-separated commit fields.
 * @returns The parsed entry, or `null` when the record is empty or malformed.
 */
function parseLogRecord(record: string): ActivityLogEntry | null {
  if (record.length === 0) return null;

  const [sha, committedAt, authorName, authorEmail, ...rest] = record.split(FIELD_SEPARATOR);
  if (
    sha === undefined ||
    committedAt === undefined ||
    authorName === undefined ||
    authorEmail === undefined ||
    rest.length === 0
  ) {
    return null;
  }

  return { sha, committedAt, authorName, authorEmail, subject: rest.join(FIELD_SEPARATOR) };
}

export interface HeadCommit {
  sha: string;
  committedAt: string;
}

/**
 * Reads the commit at HEAD — its full SHA and committer date (strict ISO 8601,
 * the same `%cI` primitive the activity log uses) — to anchor a Scan result in
 * time. Reads the committed state, so it is unaffected by the working tree.
 *
 * @param cwd - The directory git runs in — the design system root.
 * @returns The HEAD commit, or `null` when `cwd` is not a git work tree, has no
 *   commits yet, or git could not produce the record.
 */
export function readHeadCommit(cwd: string): HeadCommit | null {
  const format = ["%H", "%cI"].join(FIELD_SEPARATOR);
  const result = spawnSync("git", ["log", "-1", `--pretty=format:${format}`], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;

  const [sha, committedAt] = result.stdout.trim().split(FIELD_SEPARATOR);
  if (sha === undefined || committedAt === undefined || sha === "") return null;

  return { sha, committedAt };
}
