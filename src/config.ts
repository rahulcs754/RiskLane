import { existsSync, readFileSync } from 'node:fs';
import type { Config, Lane, SensitiveRule } from './types.js';

/** Match a keyword in any folder or file name. */
function anyPart(words: string[]): string[] {
  return words.flatMap((w) => [`**/*${w}*/**`, `*${w}*`]);
}

/** Areas where a bug hurts most. Users can add more or change points by name. */
export const DEFAULT_SENSITIVE: SensitiveRule[] = [
  {
    name: 'Auth and security',
    paths: [...anyPart(['auth', 'security', 'session', 'permission', 'rbac', 'acl', 'crypto', 'jwt', 'password']), '**/middleware.*'],
    points: 20,
  },
  {
    name: 'Payments and billing',
    paths: anyPart(['payment', 'billing', 'checkout', 'invoice', 'stripe', 'razorpay', 'subscription', 'refund', 'wallet']),
    points: 20,
  },
  {
    name: 'Database migrations and schema',
    paths: ['**/migrations/**', '**/migrate/**', '*.sql', '**/schema.prisma', '**/drizzle/**', '*schema.rb', '**/alembic/**'],
    points: 20,
  },
  {
    name: 'Infrastructure and deploy',
    paths: ['*.tf', '*.tfvars', '*Dockerfile*', 'docker-compose*.yml', 'docker-compose*.yaml', '**/k8s/**', '**/kubernetes/**', '**/helm/**', '**/terraform/**', 'serverless.yml', 'vercel.json', 'netlify.toml', 'fly.toml', 'Procfile', 'nginx*.conf'],
    points: 15,
  },
  {
    name: 'CI and release pipeline',
    paths: ['.github/workflows/**', '.gitlab-ci.yml', '.circleci/**', 'Jenkinsfile', '.github/actions/**'],
    points: 10,
  },
  {
    name: 'App and build config',
    paths: ['next.config.*', 'vite.config.*', 'webpack.config.*', 'tsconfig*.json', '.env.example', 'middleware.ts', '**/config/**'],
    points: 5,
  },
];

/** Files that do not change runtime behavior. They do not count toward risk. */
export const DEFAULT_IGNORE: string[] = [
  '*.md', '*.mdx', '*.txt', 'docs/**', 'LICENSE*', 'CHANGELOG*',
  '*.snap', '**/__snapshots__/**',
  'dist/**', 'build/**', '*.min.js', '*.map', '**/generated/**', '**/__generated__/**',
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.svg', '*.ico', '*.webp',
];

export const DEFAULT_CONFIG: Config = {
  thresholds: { medium: 30, high: 60 },
  ignore: DEFAULT_IGNORE,
  sensitive: DEFAULT_SENSITIVE,
  reviewers: {},
  labels: true,
  hotspots: true,
  failOn: 'none',
};

const LANES = ['low', 'medium', 'high'] as const;

function fail(msg: string): never {
  throw new Error(`risklane.json: ${msg}`);
}

function strings(v: unknown, key: string): string[] {
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) fail(`${key} must be an array of strings`);
  return v as string[];
}

function num(v: unknown, key: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) fail(`${key} must be a number 0-100`);
  return v as number;
}

export function parseConfig(raw: unknown): Config {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('must be a JSON object');
  const o = raw as Record<string, unknown>;
  const c: Config = structuredClone(DEFAULT_CONFIG);

  if (o.thresholds !== undefined) {
    const t = o.thresholds as Record<string, unknown>;
    if (t === null || typeof t !== 'object') fail('thresholds must be an object');
    if (t.medium !== undefined) c.thresholds.medium = num(t.medium, 'thresholds.medium');
    if (t.high !== undefined) c.thresholds.high = num(t.high, 'thresholds.high');
    if (c.thresholds.medium > c.thresholds.high) fail('thresholds.medium must be <= thresholds.high');
  }
  if (o.ignore !== undefined) c.ignore = [...DEFAULT_IGNORE, ...strings(o.ignore, 'ignore')];
  if (o.replaceIgnore !== undefined) c.ignore = strings(o.replaceIgnore, 'replaceIgnore');
  if (o.sensitive !== undefined) {
    if (!Array.isArray(o.sensitive)) fail('sensitive must be an array');
    for (const [i, r] of (o.sensitive as unknown[]).entries()) {
      const rule = r as Record<string, unknown>;
      if (rule === null || typeof rule !== 'object' || typeof rule.name !== 'string') fail(`sensitive[${i}].name must be a string`);
      const points = num(rule.points, `sensitive[${i}].points`);
      const existing = c.sensitive.find((s) => s.name.toLowerCase() === (rule.name as string).toLowerCase());
      if (existing) {
        existing.points = points;
        if (rule.paths !== undefined) existing.paths = strings(rule.paths, `sensitive[${i}].paths`);
      } else {
        c.sensitive.push({ name: rule.name as string, points, paths: strings(rule.paths, `sensitive[${i}].paths`) });
      }
    }
  }
  if (o.reviewers !== undefined) {
    const r = o.reviewers as Record<string, unknown>;
    if (r === null || typeof r !== 'object') fail('reviewers must be an object');
    for (const [lane, list] of Object.entries(r)) {
      if (!(LANES as readonly string[]).includes(lane)) fail(`reviewers.${lane}: lane must be low, medium or high`);
      c.reviewers[lane as Lane] = strings(list, `reviewers.${lane}`);
    }
  }
  if (o.labels !== undefined) {
    if (typeof o.labels !== 'boolean') fail('labels must be true or false');
    c.labels = o.labels;
  }
  if (o.hotspots !== undefined) {
    if (typeof o.hotspots !== 'boolean') fail('hotspots must be true or false');
    c.hotspots = o.hotspots;
  }
  if (o.failOn !== undefined) c.failOn = parseFailOn(o.failOn);
  return c;
}

export function parseFailOn(v: unknown): Config['failOn'] {
  if (v === 'none' || v === 'medium' || v === 'high') return v;
  fail('failOn must be "none", "medium" or "high"');
}

export function loadConfig(path: string): Config {
  if (!existsSync(path)) return structuredClone(DEFAULT_CONFIG);
  return parseConfig(JSON.parse(readFileSync(path, 'utf8')));
}
