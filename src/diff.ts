import { execFileSync } from 'node:child_process';
import type { FileChange } from './types.js';

function unquote(path: string): string {
  // git quotes paths with special chars: "a/some \"name\"".
  if (path.startsWith('"') && path.endsWith('"')) return JSON.parse(path) as string;
  return path;
}

function stripPrefix(path: string): string {
  return path.replace(/^[ab]\//, '');
}

/** Parse `git diff` patch text into per-file changes. */
export function parsePatch(patch: string): FileChange[] {
  const files: FileChange[] = [];
  let cur: FileChange | undefined;
  let inHunk = false;

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git (\S+|"[^"]+") (\S+|"[^"]+")$/.exec(line);
      const b = m ? stripPrefix(unquote(m[2]!)) : line.slice(11);
      cur = { path: b, status: 'modified', binary: false, additions: 0, deletions: 0, addedLines: [] };
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;
    if (!inHunk) {
      if (line.startsWith('new file mode')) cur.status = 'added';
      else if (line.startsWith('deleted file mode')) cur.status = 'deleted';
      else if (line.startsWith('rename from ')) {
        cur.status = 'renamed';
        cur.oldPath = unquote(line.slice(12));
      } else if (line.startsWith('rename to ')) cur.path = unquote(line.slice(10));
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch') cur.binary = true;
      else if (line.startsWith('+++ ') && line !== '+++ /dev/null') cur.path = stripPrefix(unquote(line.slice(4)));
      else if (line.startsWith('@@')) inHunk = true;
      continue;
    }
    if (line.startsWith('@@')) continue;
    if (line.startsWith('+')) {
      cur.additions++;
      cur.addedLines.push(line.slice(1));
    } else if (line.startsWith('-')) cur.deletions++;
  }
  return files;
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

/** Changes between the merge base of `base` and HEAD. */
export function gitDiff(base: string): FileChange[] {
  return parsePatch(git(['diff', '--no-color', '--no-ext-diff', '-M', '-U0', `${base}...HEAD`]));
}

/** How many commits touched each path in the last `days` days. Empty map if history is missing. */
export function gitChurn(base: string, paths: string[], days = 90): Map<string, number> {
  const counts = new Map<string, number>();
  if (paths.length === 0) return counts;
  try {
    const out = git(['log', base, `--since=${days}.days`, '--format=', '--name-only', '--', ...paths]);
    for (const p of out.split('\n')) {
      if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  } catch {
    // Shallow clone or no git: skip hotspots.
  }
  return counts;
}
