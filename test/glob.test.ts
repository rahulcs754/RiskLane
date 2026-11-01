import { describe, expect, it } from 'vitest';
import { matchesAny } from '../src/glob.js';

describe('glob', () => {
  it.each([
    ['src/auth/login.ts', '**/*auth*/**', true],
    ['auth/login.ts', '**/*auth*/**', true],
    ['src/lib/oauth.ts', '*auth*', true],
    ['src/lib/user.ts', '*auth*', false],
    ['.github/workflows/ci.yml', '.github/workflows/**', true],
    ['docs/a/b.md', 'docs/**', true],
    ['src/docs/x.ts', 'docs/**', false],
    ['infra/main.tf', '*.tf', true],
    ['README.MD', '*.md', true],
    ['src/a.ts', 'src/?.ts', true],
  ])('%s vs %s = %s', (path, pattern, want) => {
    expect(matchesAny(path, [pattern])).toBe(want);
  });
});
