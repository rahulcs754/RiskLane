import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, parseConfig } from '../src/config.js';
import { parsePatch } from '../src/diff.js';
import { renderMarkdown } from '../src/markdown.js';
import { scoreChanges } from '../src/score.js';
import { file } from './helpers.js';

const risky = parsePatch(readFileSync(new URL('./fixtures/risky.diff', import.meta.url), 'utf8'));

describe('scoreChanges', () => {
  it('rates a small UI change with a test as low', () => {
    const r = scoreChanges([file('src/ui/Button.tsx', { additions: 12 }), file('src/ui/Button.test.tsx', { additions: 8 })], DEFAULT_CONFIG);
    expect(r).toMatchObject({ score: 0, lane: 'low', findings: [] });
  });

  it('rates the risky fixture as high and explains why', () => {
    const r = scoreChanges(risky, DEFAULT_CONFIG);
    expect(r.lane).toBe('high');
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.findings.map((f) => f.id)).toEqual(
      expect.arrayContaining(['sensitive:auth-and-security', 'sensitive:database-migrations-and-schema', 'pattern:sql-concat', 'pattern:empty-catch', 'deleted']),
    );
    expect(r.ignored).toEqual(['logo.png', 'README.md']);
  });

  it('sorts findings by points and caps the score at 100', () => {
    const big = [
      file('src/auth/a.ts', { additions: 2000, lines: ['eval(x)', 'execSync(c)', 'el.innerHTML = h', "q = `SELECT * FROM t WHERE a=${b}`"] }),
      file('src/payments/p.ts'), file('db/migrations/1.sql'), file('main.tf'), file('.github/workflows/x.yml'), file('package.json'),
    ];
    const r = scoreChanges(big, DEFAULT_CONFIG);
    expect(r.score).toBe(100);
    const points = r.findings.map((f) => f.points);
    expect(points).toEqual([...points].sort((a, b) => b - a));
    const patternTotal = r.findings.filter((f) => f.id.startsWith('pattern:')).reduce((n, f) => n + f.points, 0);
    expect(patternTotal).toBeLessThanOrEqual(25);
  });

  it('docs-only PRs are low with a clear note', () => {
    const r = scoreChanges([file('README.md', { additions: 400 }), file('docs/guide.md', { additions: 900 })], DEFAULT_CONFIG);
    expect(r).toMatchObject({ score: 0, lane: 'low', files: [] });
    expect(renderMarkdown(r, DEFAULT_CONFIG)).toContain('Only docs, assets or generated files changed');
  });

  it('uses custom thresholds and rules', () => {
    const config = parseConfig({ thresholds: { medium: 10, high: 25 }, sensitive: [{ name: 'Pricing', paths: ['src/pricing/**'], points: 25 }] });
    expect(scoreChanges([file('src/pricing/plans.ts')], config).lane).toBe('high');
  });
});

describe('renderMarkdown', () => {
  it('matches the snapshot', () => {
    const r = scoreChanges(risky, DEFAULT_CONFIG);
    expect(renderMarkdown(r, DEFAULT_CONFIG, { reviewers: ['senior-dev'] })).toMatchSnapshot();
  });
});
