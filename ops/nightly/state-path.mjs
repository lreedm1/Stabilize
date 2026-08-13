import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";

function nearestCanonicalPath(candidate) {
  let cursor = candidate;
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error("Could not resolve the state directory parent");
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const base = realpathSync(cursor);
  return path.join(base, ...suffix);
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolvePrivateStateDirectory(rawPath, { home, repoRoot, tempRoot, uid }) {
  if (typeof rawPath !== "string" || !rawPath || !path.isAbsolute(rawPath)) {
    throw new Error("The nightly state directory must be an absolute path");
  }
  const requested = path.resolve(rawPath);
  if (existsSync(requested) && lstatSync(requested).isSymbolicLink()) {
    throw new Error("The nightly state directory cannot be a symbolic link");
  }
  const resolved = nearestCanonicalPath(requested);
  const root = path.parse(resolved).root;
  const canonicalHome = realpathSync(home);
  const canonicalRepo = realpathSync(repoRoot);
  const canonicalTemp = realpathSync(tempRoot);
  if (
    [root, canonicalHome, canonicalRepo, canonicalTemp].includes(resolved) ||
    contains(canonicalRepo, resolved) ||
    contains(resolved, canonicalRepo)
  ) {
    throw new Error("Refusing a broad or repository-overlapping nightly state directory");
  }
  if (existsSync(resolved)) {
    const stat = lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid) {
      throw new Error("Existing nightly state must be a user-owned real directory");
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new Error("Existing nightly state directory must already use owner-only permissions");
    }
  }
  return resolved;
}
