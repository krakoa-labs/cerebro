/**
 * Normalizes a filesystem path to use forward slashes regardless of platform.
 * Used when writing paths to config or scan output so that the same logical
 * path is represented identically on Windows, macOS, and Linux.
 *
 * @param path - The path to normalize.
 * @returns The path with all backslashes replaced by forward slashes.
 */
export function toPosixPath(path: string): string {
  return path.split(/[\\/]/).join("/");
}
