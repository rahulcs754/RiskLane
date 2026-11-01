import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import {
  deletionSignal,
  dependencySignal,
  hotspotSignal,
  patternSignal,
  sensitiveSignal,
  sizeSignal,
  testSignal,
} from '../src/signals.js';
import { file } from './helpers.js';

const ids = (fs: { id: string }[]) => fs.map((f) => f.id);

describe('size', () => {
  it('is quiet for small diffs', () => {
    expect(sizeSignal([file('a.ts', { additions: 30 })])).toEqual([]);
  });
  it('scales with lines and ignores lockfiles', () => {
    expect(sizeSignal([file('a.ts', { additions: 600 })])[0]?.points).toBe(20);
    expect(sizeSignal([file('package-lock.json', { additions: 5000 })])).toEqual([]);
  });
  it('flags many files', () => {
    const many = Array.from({ length: 16 }, (_, i) => file(`f${i}.ts`, { additions: 1 }));
    expect(ids(sizeSignal(many))).toEqual(['size:files']);
  });
});

describe('sensitive', () => {
  it('flags each area once with its files', () => {
    const out = sensitiveSignal(
      [file('src/auth/login.ts'), file('src/auth/jwt.ts'), file('prisma/migrations/1/migration.sql'), file('src/ui/Button.tsx')],
      DEFAULT_CONFIG,
    );
    expect(ids(out)).toEqual(['sensitive:auth-and-security', 'sensitive:database-migrations-and-schema']);
    expect(out[0]!.files).toEqual(['src/auth/login.ts', 'src/auth/jwt.ts']);
  });
  it('matches payments, infra and CI', () => {
    const out = sensitiveSignal(
      [file('app/checkout/page.tsx'), file('infra/main.tf'), file('.github/workflows/deploy.yml')],
      DEFAULT_CONFIG,
    );
    expect(ids(out)).toEqual(['sensitive:payments-and-billing', 'sensitive:infrastructure-and-deploy', 'sensitive:ci-and-release-pipeline']);
  });
  it('checks the old path of a rename', () => {
    expect(sensitiveSignal([file('src/x.ts', { status: 'renamed', oldPath: 'src/auth/x.ts' })], DEFAULT_CONFIG)).toHaveLength(1);
  });
});

describe('dependencies', () => {
  it('manifest beats lockfile', () => {
    expect(dependencySignal([file('package.json'), file('package-lock.json')])[0]?.points).toBe(8);
    expect(dependencySignal([file('pnpm-lock.yaml')])[0]?.points).toBe(4);
    expect(dependencySignal([file('src/a.ts')])).toEqual([]);
  });
});

describe('tests', () => {
  const code = file('src/cart.ts', { additions: 40 });
  it('flags code with no test change', () => {
    expect(ids(testSignal([code]))).toEqual(['no-tests']);
  });
  it('is quiet when a test changed or the change is tiny', () => {
    expect(testSignal([code, file('src/cart.test.ts', { additions: 5 })])).toEqual([]);
    expect(testSignal([code, file('tests/test_cart.py')])).toEqual([]);
    expect(testSignal([file('src/cart.ts', { additions: 10 })])).toEqual([]);
  });
});

describe('deletions', () => {
  it('counts deleted source files only', () => {
    expect(deletionSignal([file('src/a.ts', { status: 'deleted' })])[0]?.points).toBe(5);
    expect(deletionSignal([file('notes.txt', { status: 'deleted' })])).toEqual([]);
  });
});

describe('patterns', () => {
  const hit = (line: string, path = 'src/x.ts') => ids(patternSignal([file(path, { lines: [line] })]));

  it.each([
    ['const fn = eval(code)', 'pattern:eval'],
    ['<div dangerouslySetInnerHTML={{ __html: html }} />', 'pattern:raw-html'],
    ["el.innerHTML = userInput", 'pattern:raw-html'],
    ["execSync(`rm -rf ${dir}`)", 'pattern:shell'],
    ["subprocess.run(cmd, shell=True)", 'pattern:shell'],
    ['db.query(`SELECT * FROM users WHERE id = ${id}`)', 'pattern:sql-concat'],
    ['const q = "DELETE FROM orders WHERE id=" + id', 'pattern:sql-concat'],
    ['// eslint-disable-next-line', 'pattern:disable-checks'],
    ['} catch (e) {}', 'pattern:empty-catch'],
    ["fetch('http://api.example.com')", 'pattern:insecure-http'],
    ['https.request({ rejectUnauthorized: false })', 'pattern:tls-off'],
  ])('%s -> %s', (line, id) => {
    expect(hit(line)).toEqual([id]);
  });

  it('does not flag normal code', () => {
    expect(hit('const re = /a/; re.exec(s);')).toEqual([]);
    expect(hit("const label = 'Delete ' + name;")).toEqual([]);
    expect(hit("fetch('http://localhost:3000')")).toEqual([]);
  });

  it('skips test files, non-code files and ignored lines', () => {
    expect(hit('eval(x)', 'src/x.test.ts')).toEqual([]);
    expect(hit('eval(x)', 'notes.md')).toEqual([]);
    expect(hit('eval(x) // risklane: ignore')).toEqual([]);
  });
});

describe('hotspots', () => {
  it('flags often-changed files, not new ones', () => {
    const churn = new Map([['src/a.ts', 12], ['src/b.ts', 3], ['src/new.ts', 20]]);
    const out = hotspotSignal([file('src/a.ts'), file('src/b.ts'), file('src/new.ts', { status: 'added' })], churn);
    expect(out[0]).toMatchObject({ points: 5, files: ['src/a.ts'] });
  });
});
