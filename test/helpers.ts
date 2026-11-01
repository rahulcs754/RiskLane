import type { FileChange } from '../src/types.js';

export function file(path: string, opts: Partial<FileChange> & { lines?: string[] } = {}): FileChange {
  const addedLines = opts.lines ?? opts.addedLines ?? [];
  return {
    path,
    status: opts.status ?? 'modified',
    binary: false,
    additions: opts.additions ?? addedLines.length,
    deletions: opts.deletions ?? 0,
    addedLines,
    ...(opts.oldPath ? { oldPath: opts.oldPath } : {}),
  };
}
