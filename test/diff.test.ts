import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePatch } from '../src/diff.js';

const patch = readFileSync(new URL('./fixtures/risky.diff', import.meta.url), 'utf8');

describe('parsePatch', () => {
  const files = parsePatch(patch);
  const by = (p: string) => files.find((f) => f.path === p)!;

  it('finds every file', () => {
    expect(files.map((f) => f.path)).toEqual([
      'src/auth/session.ts',
      'db/migrations/20261101_add_plan.sql',
      'src/api/users.ts',
      'src/old.ts',
      'src/b.ts',
      'logo.png',
      'README.md',
    ]);
  });

  it('counts lines and keeps added text', () => {
    expect(by('src/auth/session.ts')).toMatchObject({ additions: 4, deletions: 1, status: 'modified' });
    expect(by('src/auth/session.ts').addedLines).toContain('  } catch {}');
  });

  it('reads status: added, deleted, renamed, binary', () => {
    expect(by('db/migrations/20261101_add_plan.sql').status).toBe('added');
    expect(by('src/old.ts')).toMatchObject({ status: 'deleted', deletions: 3 });
    expect(by('src/b.ts')).toMatchObject({ status: 'renamed', oldPath: 'src/a.ts' });
    expect(by('logo.png').binary).toBe(true);
  });

  it('does not count "+++" / "---" headers as lines', () => {
    expect(by('README.md')).toMatchObject({ additions: 1, deletions: 1 });
  });

  it('handles quoted paths', () => {
    const f = parsePatch('diff --git "a/my file.ts" "b/my file.ts"\n--- "a/my file.ts"\n+++ "b/my file.ts"\n@@ -1 +1 @@\n-a\n+b\n');
    expect(f[0]).toMatchObject({ path: 'my file.ts', additions: 1 });
  });
});
