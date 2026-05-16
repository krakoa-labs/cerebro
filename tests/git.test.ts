import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectGitRepo, inspectGit, readActivityLog } from "../src/git.js";

// Pin the commit identity through environment variables: they outrank both
// `-c user.*` config and any GIT_* vars a surrounding git hook may export.
const COMMIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Dev Example",
  GIT_AUTHOR_EMAIL: "dev@example.com",
  GIT_COMMITTER_NAME: "Dev Example",
  GIT_COMMITTER_EMAIL: "dev@example.com",
};

describe("detectGitRepo", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cerebro-git-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("returns false for a directory outside any git repository", () => {
    expect(detectGitRepo(cwd)).toBe(false);
  });

  it("returns true once the directory is initialized as a git repository", () => {
    spawnSync("git", ["init"], { cwd });
    expect(detectGitRepo(cwd)).toBe(true);
  });
});

describe("inspectGit", () => {
  let dirs: string[];

  beforeEach(() => {
    dirs = [];
  });

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "cerebro-inspect-"));
    dirs.push(dir);
    return dir;
  }

  it("reports unavailable outside any git repository", () => {
    expect(inspectGit(tempDir())).toEqual({ available: false, shallow: false });
  });

  it("reports available and not shallow for a normal repository", () => {
    const cwd = tempDir();
    spawnSync("git", ["init"], { cwd });
    expect(inspectGit(cwd)).toEqual({ available: true, shallow: false });
  });

  it("reports shallow for a depth-limited clone", () => {
    const origin = tempDir();
    spawnSync("git", ["init"], { cwd: origin });
    writeFileSync(join(origin, "file.txt"), "content");
    spawnSync("git", ["add", "."], { cwd: origin });
    spawnSync("git", ["commit", "-m", "initial"], { cwd: origin, env: COMMIT_ENV });

    const clone = tempDir();
    spawnSync("git", ["clone", "--depth=1", `file://${origin}`, clone]);

    expect(inspectGit(clone)).toEqual({ available: true, shallow: true });
  });
});

describe("readActivityLog", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cerebro-log-"));
    spawnSync("git", ["init"], { cwd });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function commit(file: string, content: string, message: string): void {
    writeFileSync(join(cwd, file), content);
    spawnSync("git", ["add", "."], { cwd });
    spawnSync("git", ["commit", "-m", message], { cwd, env: COMMIT_ENV });
  }

  it("returns commits newest first with sha, date, author and subject", () => {
    commit("file.txt", "one", "first commit");
    commit("file.txt", "two", "second commit");

    const log = readActivityLog(cwd, "file.txt", 20);

    expect(log.map((e) => e.subject)).toEqual(["second commit", "first commit"]);
    expect(log[0]?.authorName).toBe("Dev Example");
    expect(log[0]?.authorEmail).toBe("dev@example.com");
    expect(log[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(Number.isNaN(Date.parse(log[0]?.committedAt ?? ""))).toBe(false);
  });

  it("caps the log at the requested depth", () => {
    commit("file.txt", "1", "commit one");
    commit("file.txt", "2", "commit two");
    commit("file.txt", "3", "commit three");

    const log = readActivityLog(cwd, "file.txt", 2);

    expect(log.map((e) => e.subject)).toEqual(["commit three", "commit two"]);
  });

  it("returns an empty log for a path with no commits", () => {
    commit("file.txt", "x", "only commit");

    expect(readActivityLog(cwd, "untouched.txt", 20)).toEqual([]);
  });
});
