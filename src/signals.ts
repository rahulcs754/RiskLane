import { matchesAny } from './glob.js';
import type { Config, FileChange, Finding } from './types.js';

const LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'Cargo.lock', 'poetry.lock', 'Gemfile.lock', 'go.sum', 'composer.lock'];
const MANIFESTS = ['package.json', 'requirements*.txt', 'pyproject.toml', 'Pipfile', 'go.mod', 'Cargo.toml', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', '*.csproj'];
const TEST_PATTERNS = ['*.test.*', '*.spec.*', '**/__tests__/**', '**/test/**', '**/tests/**', '**/e2e/**', '**/cypress/**', '*_test.go', 'test_*.py', '*_test.py', '*Test.java', '*Tests.cs', '*_spec.rb'];
const SOURCE_EXT = /\.(c|cc|cpp|cs|dart|ex|exs|go|java|js|jsx|kt|mjs|cjs|php|py|rb|rs|scala|swift|ts|tsx|vue|svelte)$/i;

export const isLockfile = (p: string) => matchesAny(p, LOCKFILES);
export const isTest = (p: string) => matchesAny(p, TEST_PATTERNS);
export const isSource = (p: string) => SOURCE_EXT.test(p) && !isTest(p);

function finding(id: string, points: number, reason: string, files: string[] = []): Finding {
  return { id, points, reason, files };
}

export function sizeSignal(files: FileChange[]): Finding[] {
  const counted = files.filter((f) => !isLockfile(f.path));
  const lines = counted.reduce((n, f) => n + f.additions + f.deletions, 0);
  const out: Finding[] = [];
  const tiers: Array<[number, number]> = [[1000, 30], [500, 20], [200, 12], [50, 5]];
  const tier = tiers.find(([min]) => lines > min);
  if (tier) out.push(finding('size:lines', tier[1], `Large diff: ${lines} lines changed`));
  if (counted.length >= 40) out.push(finding('size:files', 10, `Touches ${counted.length} files`));
  else if (counted.length >= 15) out.push(finding('size:files', 5, `Touches ${counted.length} files`));
  return out;
}

export function sensitiveSignal(files: FileChange[], config: Config): Finding[] {
  const out: Finding[] = [];
  for (const rule of config.sensitive) {
    if (rule.points <= 0) continue;
    const hits = files
      .filter((f) => matchesAny(f.path, rule.paths) || (f.oldPath !== undefined && matchesAny(f.oldPath, rule.paths)))
      .map((f) => f.path);
    if (hits.length) {
      const id = `sensitive:${rule.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      out.push(finding(id, rule.points, `Sensitive area: ${rule.name}`, hits));
    }
  }
  return out;
}

export function dependencySignal(files: FileChange[]): Finding[] {
  const manifests = files.filter((f) => matchesAny(f.path, MANIFESTS)).map((f) => f.path);
  const locks = files.filter((f) => isLockfile(f.path)).map((f) => f.path);
  if (manifests.length) return [finding('dependencies', 8, 'Dependencies or package manifest changed', [...manifests, ...locks])];
  if (locks.length) return [finding('dependencies', 4, 'Lockfile changed (dependency versions moved)', locks)];
  return [];
}

export function testSignal(files: FileChange[]): Finding[] {
  const src = files.filter((f) => isSource(f.path) && f.status !== 'deleted');
  const added = src.reduce((n, f) => n + f.additions, 0);
  const testsTouched = files.some((f) => isTest(f.path));
  if (added > 20 && !testsTouched) {
    return [finding('no-tests', 15, `${added} lines of code added or changed, but no test files changed`, src.map((f) => f.path))];
  }
  return [];
}

export function deletionSignal(files: FileChange[]): Finding[] {
  const deleted = files.filter((f) => f.status === 'deleted' && isSource(f.path)).map((f) => f.path);
  if (deleted.length >= 5) return [finding('deleted', 10, `${deleted.length} source files deleted`, deleted)];
  if (deleted.length) return [finding('deleted', 5, `${deleted.length} source file(s) deleted`, deleted)];
  return [];
}

interface PatternRule {
  id: string;
  points: number;
  reason: string;
  re: RegExp;
}

export const PATTERNS: PatternRule[] = [
  { id: 'eval', points: 10, reason: 'Dynamic code execution (eval / new Function)', re: /\beval\s*\(|\bnew\s+Function\s*\(/ },
  { id: 'raw-html', points: 8, reason: 'Raw HTML injection (dangerouslySetInnerHTML / innerHTML / v-html)', re: /dangerouslySetInnerHTML|\.(inner|outer)HTML\s*=|\bv-html\b/ },
  { id: 'shell', points: 10, reason: 'Runs shell commands (exec / spawn / os.system)', re: /\b(child_process|execSync|execFileSync|spawnSync|os\.system|os\.popen|subprocess\.(run|call|Popen))\b|(?<![.\w])exec\s*\(|shell\s*=\s*True/ },
  {
    id: 'sql-concat',
    points: 10,
    reason: 'SQL built from strings (injection risk)',
    re: /\b(SELECT\b[\s\S]*\bFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b[\s\S]*(\$\{|['"`]\s*\+|%s|\.format\()/i,
  },
  { id: 'disable-checks', points: 5, reason: 'Turns off lint or type checks (eslint-disable / @ts-ignore / nolint)', re: /eslint-disable|@ts-ignore|@ts-nocheck|@ts-expect-error|#\s*type:\s*ignore|\/\/\s*nolint|#\s*noqa/ },
  { id: 'empty-catch', points: 5, reason: 'Empty catch block (errors are swallowed)', re: /catch\s*(\([^)]*\))?\s*\{\s*\}|except[^:]*:\s*pass\b/ },
  { id: 'insecure-http', points: 3, reason: 'Plain http:// URL (not localhost)', re: /['"`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/ },
  { id: 'tls-off', points: 8, reason: 'Turns off TLS or CORS safety (rejectUnauthorized: false / verify=False / origin "*")', re: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED|Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]/ },
];

export function patternSignal(files: FileChange[]): Finding[] {
  const out: Finding[] = [];
  for (const rule of PATTERNS) {
    const hits = files
      .filter((f) => SOURCE_EXT.test(f.path) && !isTest(f.path))
      .filter((f) => f.addedLines.some((l) => rule.re.test(l) && !/risklane:\s*ignore/.test(l)))
      .map((f) => f.path);
    if (hits.length) out.push(finding(`pattern:${rule.id}`, rule.points, rule.reason, hits));
  }
  return out;
}

/** Files that changed often lately break more often. */
export function hotspotSignal(files: FileChange[], churn: Map<string, number>, minCommits = 10): Finding[] {
  const hot = files
    .filter((f) => f.status !== 'added' && (churn.get(f.path) ?? 0) >= minCommits)
    .map((f) => f.path);
  if (!hot.length) return [];
  return [finding('hotspot', Math.min(10, hot.length * 5), `Hotspot: ${hot.length} file(s) changed ${minCommits}+ times in the last 90 days`, hot)];
}
