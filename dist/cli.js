#!/usr/bin/env node

// src/cli.ts
import { appendFileSync, readFileSync as readFileSync3, writeFileSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "util";

// src/config.ts
import { existsSync, readFileSync } from "fs";
function anyPart(words) {
  return words.flatMap((w) => [`**/*${w}*/**`, `*${w}*`]);
}
var DEFAULT_SENSITIVE = [
  {
    name: "Auth and security",
    paths: [...anyPart(["auth", "security", "session", "permission", "rbac", "acl", "crypto", "jwt", "password"]), "**/middleware.*"],
    points: 20
  },
  {
    name: "Payments and billing",
    paths: anyPart(["payment", "billing", "checkout", "invoice", "stripe", "razorpay", "subscription", "refund", "wallet"]),
    points: 20
  },
  {
    name: "Database migrations and schema",
    paths: ["**/migrations/**", "**/migrate/**", "*.sql", "**/schema.prisma", "**/drizzle/**", "*schema.rb", "**/alembic/**"],
    points: 20
  },
  {
    name: "Infrastructure and deploy",
    paths: ["*.tf", "*.tfvars", "*Dockerfile*", "docker-compose*.yml", "docker-compose*.yaml", "**/k8s/**", "**/kubernetes/**", "**/helm/**", "**/terraform/**", "serverless.yml", "vercel.json", "netlify.toml", "fly.toml", "Procfile", "nginx*.conf"],
    points: 15
  },
  {
    name: "CI and release pipeline",
    paths: [".github/workflows/**", ".gitlab-ci.yml", ".circleci/**", "Jenkinsfile", ".github/actions/**"],
    points: 10
  },
  {
    name: "App and build config",
    paths: ["next.config.*", "vite.config.*", "webpack.config.*", "tsconfig*.json", ".env.example", "middleware.ts", "**/config/**"],
    points: 5
  }
];
var DEFAULT_IGNORE = [
  "*.md",
  "*.mdx",
  "*.txt",
  "docs/**",
  "LICENSE*",
  "CHANGELOG*",
  "*.snap",
  "**/__snapshots__/**",
  "dist/**",
  "build/**",
  "*.min.js",
  "*.map",
  "**/generated/**",
  "**/__generated__/**",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.svg",
  "*.ico",
  "*.webp"
];
var DEFAULT_CONFIG = {
  thresholds: { medium: 30, high: 60 },
  ignore: DEFAULT_IGNORE,
  sensitive: DEFAULT_SENSITIVE,
  reviewers: {},
  labels: true,
  hotspots: true,
  failOn: "none"
};
var LANES = ["low", "medium", "high"];
function fail(msg) {
  throw new Error(`risklane.json: ${msg}`);
}
function strings(v, key) {
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) fail(`${key} must be an array of strings`);
  return v;
}
function num(v, key) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) fail(`${key} must be a number 0-100`);
  return v;
}
function parseConfig(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) fail("must be a JSON object");
  const o = raw;
  const c = structuredClone(DEFAULT_CONFIG);
  if (o.thresholds !== void 0) {
    const t = o.thresholds;
    if (t === null || typeof t !== "object") fail("thresholds must be an object");
    if (t.medium !== void 0) c.thresholds.medium = num(t.medium, "thresholds.medium");
    if (t.high !== void 0) c.thresholds.high = num(t.high, "thresholds.high");
    if (c.thresholds.medium > c.thresholds.high) fail("thresholds.medium must be <= thresholds.high");
  }
  if (o.ignore !== void 0) c.ignore = [...DEFAULT_IGNORE, ...strings(o.ignore, "ignore")];
  if (o.replaceIgnore !== void 0) c.ignore = strings(o.replaceIgnore, "replaceIgnore");
  if (o.sensitive !== void 0) {
    if (!Array.isArray(o.sensitive)) fail("sensitive must be an array");
    for (const [i, r] of o.sensitive.entries()) {
      const rule = r;
      if (rule === null || typeof rule !== "object" || typeof rule.name !== "string") fail(`sensitive[${i}].name must be a string`);
      const points = num(rule.points, `sensitive[${i}].points`);
      const existing = c.sensitive.find((s) => s.name.toLowerCase() === rule.name.toLowerCase());
      if (existing) {
        existing.points = points;
        if (rule.paths !== void 0) existing.paths = strings(rule.paths, `sensitive[${i}].paths`);
      } else {
        c.sensitive.push({ name: rule.name, points, paths: strings(rule.paths, `sensitive[${i}].paths`) });
      }
    }
  }
  if (o.reviewers !== void 0) {
    const r = o.reviewers;
    if (r === null || typeof r !== "object") fail("reviewers must be an object");
    for (const [lane, list] of Object.entries(r)) {
      if (!LANES.includes(lane)) fail(`reviewers.${lane}: lane must be low, medium or high`);
      c.reviewers[lane] = strings(list, `reviewers.${lane}`);
    }
  }
  if (o.labels !== void 0) {
    if (typeof o.labels !== "boolean") fail("labels must be true or false");
    c.labels = o.labels;
  }
  if (o.hotspots !== void 0) {
    if (typeof o.hotspots !== "boolean") fail("hotspots must be true or false");
    c.hotspots = o.hotspots;
  }
  if (o.failOn !== void 0) c.failOn = parseFailOn(o.failOn);
  return c;
}
function parseFailOn(v) {
  if (v === "none" || v === "medium" || v === "high") return v;
  fail('failOn must be "none", "medium" or "high"');
}
function loadConfig(path) {
  if (!existsSync(path)) return structuredClone(DEFAULT_CONFIG);
  return parseConfig(JSON.parse(readFileSync(path, "utf8")));
}

// src/diff.ts
import { execFileSync } from "child_process";
function unquote(path) {
  if (path.startsWith('"') && path.endsWith('"')) return JSON.parse(path);
  return path;
}
function stripPrefix(path) {
  return path.replace(/^[ab]\//, "");
}
function parsePatch(patch) {
  const files = [];
  let cur;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git (\S+|"[^"]+") (\S+|"[^"]+")$/.exec(line);
      const b = m ? stripPrefix(unquote(m[2])) : line.slice(11);
      cur = { path: b, status: "modified", binary: false, additions: 0, deletions: 0, addedLines: [] };
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;
    if (!inHunk) {
      if (line.startsWith("new file mode")) cur.status = "added";
      else if (line.startsWith("deleted file mode")) cur.status = "deleted";
      else if (line.startsWith("rename from ")) {
        cur.status = "renamed";
        cur.oldPath = unquote(line.slice(12));
      } else if (line.startsWith("rename to ")) cur.path = unquote(line.slice(10));
      else if (line.startsWith("Binary files ") || line === "GIT binary patch") cur.binary = true;
      else if (line.startsWith("+++ ") && line !== "+++ /dev/null") cur.path = stripPrefix(unquote(line.slice(4)));
      else if (line.startsWith("@@")) inHunk = true;
      continue;
    }
    if (line.startsWith("@@")) continue;
    if (line.startsWith("+")) {
      cur.additions++;
      cur.addedLines.push(line.slice(1));
    } else if (line.startsWith("-")) cur.deletions++;
  }
  return files;
}
function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}
function gitDiff(base) {
  return parsePatch(git(["diff", "--no-color", "--no-ext-diff", "-M", "-U0", `${base}...HEAD`]));
}
function gitChurn(base, paths, days = 90) {
  const counts = /* @__PURE__ */ new Map();
  if (paths.length === 0) return counts;
  try {
    const out = git(["log", base, `--since=${days}.days`, "--format=", "--name-only", "--", ...paths]);
    for (const p of out.split("\n")) {
      if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  } catch {
  }
  return counts;
}

// src/github.ts
import { readFileSync as readFileSync2 } from "fs";

// src/markdown.ts
var MARKER = "<!-- risklane -->";
var LANE_INFO = {
  low: { icon: "\u{1F7E2}", title: "Low risk", advice: "Small change in a safe area. One quick review is enough." },
  medium: { icon: "\u{1F7E1}", title: "Medium risk", advice: "Give this a normal, careful review." },
  high: { icon: "\u{1F534}", title: "High risk", advice: "Needs a senior reviewer. Check the areas below closely before merging." }
};
var MAX_FILES = 5;
function fileList(files) {
  if (!files.length) return "";
  const shown = files.slice(0, MAX_FILES).map((f) => `\`${f}\``).join(", ");
  return files.length > MAX_FILES ? `${shown} +${files.length - MAX_FILES} more` : shown;
}
function escapeCell(s) {
  return s.replace(/\|/g, "\\|");
}
function renderMarkdown(result, config, extra = {}) {
  const info = LANE_INFO[result.lane];
  const lines = [
    MARKER,
    `## ${info.icon} RiskLane: ${info.title} (${result.score}/100)`,
    "",
    info.advice,
    ""
  ];
  if (result.files.length === 0 && result.ignored.length === 0) {
    lines.push("No changed files found against the base branch.");
  } else if (result.files.length === 0) {
    lines.push("Only docs, assets or generated files changed, so there is nothing risky to score.");
  } else if (result.findings.length === 0) {
    lines.push("No risk signals found.");
  } else {
    lines.push("| Points | Why | Files |", "| ---: | --- | --- |");
    for (const f of result.findings) {
      lines.push(`| +${f.points} | ${escapeCell(f.reason)} | ${escapeCell(fileList(f.files))} |`);
    }
  }
  lines.push("");
  if (extra.reviewers?.length) {
    lines.push(`Requested review from ${extra.reviewers.map((r) => `@${r}`).join(", ")}.`, "");
  }
  const counted = result.files.length;
  const skipped = result.ignored.length ? `, ${result.ignored.length} ignored (docs, assets, generated)` : "";
  lines.push(
    `<sub>${counted} file(s) scored${skipped}. Lanes: low < ${config.thresholds.medium}, medium < ${config.thresholds.high}, high \u2265 ${config.thresholds.high}. Tune in \`risklane.json\`. Rule-based, no code leaves CI.</sub>`
  );
  return lines.join("\n") + "\n";
}

// src/github.ts
function prContext(env = process.env) {
  const [owner, repo] = (env.GITHUB_REPOSITORY ?? "").split("/");
  if (!owner || !repo || !env.GITHUB_EVENT_PATH) return void 0;
  const event = JSON.parse(readFileSync2(env.GITHUB_EVENT_PATH, "utf8"));
  const number = event.pull_request?.number;
  if (typeof number !== "number") return void 0;
  return { owner, repo, number, author: event.pull_request?.user?.login, apiUrl: env.GITHUB_API_URL ?? "https://api.github.com" };
}
var GitHubError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
  status;
};
var GitHub = class {
  constructor(token, pr, fetchFn = fetch) {
    this.token = token;
    this.pr = pr;
    this.fetchFn = fetchFn;
    this.base = `${pr.apiUrl}/repos/${pr.owner}/${pr.repo}`;
  }
  token;
  pr;
  fetchFn;
  base;
  async call(path, init = {}) {
    const res = await this.fetchFn(`${this.base}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json"
      }
    });
    if (!res.ok) throw new GitHubError(`GitHub API ${init.method ?? "GET"} ${path} failed: ${res.status}`, res.status);
    return res;
  }
  /** Create our PR comment, or update it if we posted one before. */
  async upsertComment(body) {
    for (let page = 1; page <= 10; page++) {
      const res = await this.call(`/issues/${this.pr.number}/comments?per_page=100&page=${page}`);
      const comments = await res.json();
      const ours = comments.find((c) => c.body?.includes(MARKER));
      if (ours) {
        await this.call(`/issues/comments/${ours.id}`, { method: "PATCH", body: JSON.stringify({ body }) });
        return "updated";
      }
      if (comments.length < 100) break;
    }
    await this.call(`/issues/${this.pr.number}/comments`, { method: "POST", body: JSON.stringify({ body }) });
    return "created";
  }
  /** Put exactly one `risk:<lane>` label on the PR. */
  async setLaneLabel(lane) {
    const want = `risk:${lane}`;
    const res = await this.call(`/issues/${this.pr.number}/labels?per_page=100`);
    const current = (await res.json()).map((l) => l.name);
    for (const name of current) {
      if (name.startsWith("risk:") && name !== want) {
        await this.call(`/issues/${this.pr.number}/labels/${encodeURIComponent(name)}`, { method: "DELETE" });
      }
    }
    if (current.includes(want)) return;
    await this.ensureLabel(want, LABEL_COLORS[lane]);
    await this.call(`/issues/${this.pr.number}/labels`, { method: "POST", body: JSON.stringify({ labels: [want] }) });
  }
  async ensureLabel(name, color) {
    try {
      await this.call("/labels", {
        method: "POST",
        body: JSON.stringify({ name, color, description: "Set by RiskLane" })
      });
    } catch (err) {
      if (!(err instanceof GitHubError && err.status === 422)) throw err;
    }
  }
  /** Request reviews. "org/team" entries become team reviewers. Returns who was asked. */
  async requestReviewers(list) {
    const author = this.pr.author?.toLowerCase();
    const users = list.filter((r) => !r.includes("/") && r.toLowerCase() !== author);
    const teams = list.filter((r) => r.includes("/")).map((r) => r.split("/")[1]);
    if (!users.length && !teams.length) return [];
    await this.call(`/pulls/${this.pr.number}/requested_reviewers`, {
      method: "POST",
      body: JSON.stringify({ reviewers: users, team_reviewers: teams })
    });
    return [...users, ...list.filter((r) => r.includes("/"))];
  }
};
var LABEL_COLORS = { low: "2da44e", medium: "d4a72c", high: "cf222e" };

// src/glob.ts
var cache = /* @__PURE__ */ new Map();
function globToRegExp(pattern) {
  const hit = cache.get(pattern);
  if (hit) return hit;
  let p = pattern.replace(/^\.\//, "");
  if (!p.includes("/")) p = `**/${p}`;
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      if (p[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const out = new RegExp(`^${re}$`, "i");
  cache.set(pattern, out);
  return out;
}
function matchesAny(path, patterns) {
  return patterns.some((p) => globToRegExp(p).test(path));
}

// src/signals.ts
var LOCKFILES = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock", "Cargo.lock", "poetry.lock", "Gemfile.lock", "go.sum", "composer.lock"];
var MANIFESTS = ["package.json", "requirements*.txt", "pyproject.toml", "Pipfile", "go.mod", "Cargo.toml", "Gemfile", "pom.xml", "build.gradle", "build.gradle.kts", "composer.json", "*.csproj"];
var TEST_PATTERNS = ["*.test.*", "*.spec.*", "**/__tests__/**", "**/test/**", "**/tests/**", "**/e2e/**", "**/cypress/**", "*_test.go", "test_*.py", "*_test.py", "*Test.java", "*Tests.cs", "*_spec.rb"];
var SOURCE_EXT = /\.(c|cc|cpp|cs|dart|ex|exs|go|java|js|jsx|kt|mjs|cjs|php|py|rb|rs|scala|swift|ts|tsx|vue|svelte)$/i;
var isLockfile = (p) => matchesAny(p, LOCKFILES);
var isTest = (p) => matchesAny(p, TEST_PATTERNS);
var isSource = (p) => SOURCE_EXT.test(p) && !isTest(p);
function finding(id, points, reason, files = []) {
  return { id, points, reason, files };
}
function sizeSignal(files) {
  const counted = files.filter((f) => !isLockfile(f.path));
  const lines = counted.reduce((n, f) => n + f.additions + f.deletions, 0);
  const out = [];
  const tiers = [[1e3, 30], [500, 20], [200, 12], [50, 5]];
  const tier = tiers.find(([min]) => lines > min);
  if (tier) out.push(finding("size:lines", tier[1], `Large diff: ${lines} lines changed`));
  if (counted.length >= 40) out.push(finding("size:files", 10, `Touches ${counted.length} files`));
  else if (counted.length >= 15) out.push(finding("size:files", 5, `Touches ${counted.length} files`));
  return out;
}
function sensitiveSignal(files, config) {
  const out = [];
  for (const rule of config.sensitive) {
    if (rule.points <= 0) continue;
    const hits = files.filter((f) => matchesAny(f.path, rule.paths) || f.oldPath !== void 0 && matchesAny(f.oldPath, rule.paths)).map((f) => f.path);
    if (hits.length) {
      const id = `sensitive:${rule.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      out.push(finding(id, rule.points, `Sensitive area: ${rule.name}`, hits));
    }
  }
  return out;
}
function dependencySignal(files) {
  const manifests = files.filter((f) => matchesAny(f.path, MANIFESTS)).map((f) => f.path);
  const locks = files.filter((f) => isLockfile(f.path)).map((f) => f.path);
  if (manifests.length) return [finding("dependencies", 8, "Dependencies or package manifest changed", [...manifests, ...locks])];
  if (locks.length) return [finding("dependencies", 4, "Lockfile changed (dependency versions moved)", locks)];
  return [];
}
function testSignal(files) {
  const src = files.filter((f) => isSource(f.path) && f.status !== "deleted");
  const added = src.reduce((n, f) => n + f.additions, 0);
  const testsTouched = files.some((f) => isTest(f.path));
  if (added > 20 && !testsTouched) {
    return [finding("no-tests", 15, `${added} lines of code added or changed, but no test files changed`, src.map((f) => f.path))];
  }
  return [];
}
function deletionSignal(files) {
  const deleted = files.filter((f) => f.status === "deleted" && isSource(f.path)).map((f) => f.path);
  if (deleted.length >= 5) return [finding("deleted", 10, `${deleted.length} source files deleted`, deleted)];
  if (deleted.length) return [finding("deleted", 5, `${deleted.length} source file(s) deleted`, deleted)];
  return [];
}
var PATTERNS = [
  { id: "eval", points: 10, reason: "Dynamic code execution (eval / new Function)", re: /\beval\s*\(|\bnew\s+Function\s*\(/ },
  { id: "raw-html", points: 8, reason: "Raw HTML injection (dangerouslySetInnerHTML / innerHTML / v-html)", re: /dangerouslySetInnerHTML|\.(inner|outer)HTML\s*=|\bv-html\b/ },
  { id: "shell", points: 10, reason: "Runs shell commands (exec / spawn / os.system)", re: /\b(child_process|execSync|execFileSync|spawnSync|os\.system|os\.popen|subprocess\.(run|call|Popen))\b|(?<![.\w])exec\s*\(|shell\s*=\s*True/ },
  {
    id: "sql-concat",
    points: 10,
    reason: "SQL built from strings (injection risk)",
    re: /\b(SELECT\b[\s\S]*\bFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b[\s\S]*(\$\{|['"`]\s*\+|%s|\.format\()/i
  },
  { id: "disable-checks", points: 5, reason: "Turns off lint or type checks (eslint-disable / @ts-ignore / nolint)", re: /eslint-disable|@ts-ignore|@ts-nocheck|@ts-expect-error|#\s*type:\s*ignore|\/\/\s*nolint|#\s*noqa/ },
  { id: "empty-catch", points: 5, reason: "Empty catch block (errors are swallowed)", re: /catch\s*(\([^)]*\))?\s*\{\s*\}|except[^:]*:\s*pass\b/ },
  { id: "insecure-http", points: 3, reason: "Plain http:// URL (not localhost)", re: /['"`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/ },
  { id: "tls-off", points: 8, reason: 'Turns off TLS or CORS safety (rejectUnauthorized: false / verify=False / origin "*")', re: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED|Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]/ }
];
function patternSignal(files) {
  const out = [];
  for (const rule of PATTERNS) {
    const hits = files.filter((f) => SOURCE_EXT.test(f.path) && !isTest(f.path)).filter((f) => f.addedLines.some((l) => rule.re.test(l) && !/risklane:\s*ignore/.test(l))).map((f) => f.path);
    if (hits.length) out.push(finding(`pattern:${rule.id}`, rule.points, rule.reason, hits));
  }
  return out;
}
function hotspotSignal(files, churn, minCommits = 10) {
  const hot = files.filter((f) => f.status !== "added" && (churn.get(f.path) ?? 0) >= minCommits).map((f) => f.path);
  if (!hot.length) return [];
  return [finding("hotspot", Math.min(10, hot.length * 5), `Hotspot: ${hot.length} file(s) changed ${minCommits}+ times in the last 90 days`, hot)];
}

// src/score.ts
var PATTERN_CAP = 25;
function laneFor(score, config) {
  if (score >= config.thresholds.high) return "high";
  if (score >= config.thresholds.medium) return "medium";
  return "low";
}
function scoreChanges(all, config, churn = /* @__PURE__ */ new Map()) {
  const ignored = all.filter((f) => matchesAny(f.path, config.ignore)).map((f) => f.path);
  const files = all.filter((f) => !ignored.includes(f.path));
  const patterns = patternSignal(files);
  let budget = PATTERN_CAP;
  for (const p of patterns) {
    p.points = Math.min(p.points, budget);
    budget -= p.points;
  }
  const findings = [
    ...sensitiveSignal(files, config),
    ...sizeSignal(files),
    ...testSignal(files),
    ...dependencySignal(files),
    ...deletionSignal(files),
    ...patterns.filter((p) => p.points > 0),
    ...config.hotspots ? hotspotSignal(files, churn) : []
  ].sort((a, b) => b.points - a.points);
  const score = Math.min(100, findings.reduce((n, f) => n + f.points, 0));
  return { score, lane: laneFor(score, config), findings, files, ignored };
}

// src/cli.ts
var HELP = `risklane: rate a pull request's risk from its diff

Usage:
  risklane check [options]

Options:
  --base <ref>        Compare against this ref (default: origin/<PR base> or origin/main)
  --diff <file>       Score a saved patch file instead of running git diff ("-" = stdin)
  --config <path>     Config file (default: risklane.json)
  --comment           Post or update one PR comment (needs GITHUB_TOKEN, in Actions)
  --label             Set the risk:low|medium|high label on the PR
  --reviewers         Request the reviewers listed for this lane in config
  --fail-on <lane>    Exit 1 when the lane is at or above this (none|medium|high)
  --json              Print JSON instead of Markdown
  --out <path>        Also write the Markdown report to this file
  -h, --help          Show this help
`;
var RANK = { low: 0, medium: 1, high: 2 };
function warn(message) {
  console.error(process.env.GITHUB_ACTIONS ? `::warning title=RiskLane::${message}` : `risklane: ${message}`);
}
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}
`);
}
async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      base: { type: "string" },
      diff: { type: "string" },
      config: { type: "string", default: "risklane.json" },
      comment: { type: "boolean" },
      label: { type: "boolean" },
      reviewers: { type: "boolean" },
      "fail-on": { type: "string" },
      json: { type: "boolean" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" }
    }
  });
  if (values.help || positionals[0] !== "check") {
    console.log(HELP);
    return values.help ? 0 : 2;
  }
  const config = loadConfig(resolve(values.config));
  if (values["fail-on"]) config.failOn = parseFailOn(values["fail-on"]);
  const base = values.base || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
  let changes;
  let churn = /* @__PURE__ */ new Map();
  if (values.diff) {
    changes = parsePatch(readFileSync3(values.diff === "-" ? 0 : values.diff, "utf8"));
  } else {
    changes = gitDiff(base);
    if (config.hotspots) churn = gitChurn(base, changes.map((c) => c.path));
  }
  const result = scoreChanges(changes, config, churn);
  setOutput("score", String(result.score));
  setOutput("lane", result.lane);
  const pr = prContext();
  const token = process.env.GITHUB_TOKEN;
  const gh = pr && token ? new GitHub(token, pr) : void 0;
  if ((values.comment || values.label || values.reviewers) && !gh) {
    warn(pr ? "GITHUB_TOKEN is missing; skipping PR comment, label and reviewers." : "not a pull_request run; skipping PR comment, label and reviewers.");
  }
  let asked = [];
  const wanted = config.reviewers[result.lane] ?? [];
  if (gh && values.reviewers && wanted.length) {
    try {
      asked = await gh.requestReviewers(wanted);
    } catch (err) {
      warn(`could not request reviewers: ${err.message}`);
    }
  }
  const markdown = renderMarkdown(result, config, { reviewers: asked });
  if (values.json) {
    console.log(JSON.stringify({ score: result.score, lane: result.lane, findings: result.findings, ignored: result.ignored }, null, 2));
  } else {
    console.log(markdown);
  }
  if (values.out) writeFileSync(values.out, markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  if (gh && values.label && config.labels) {
    try {
      await gh.setLaneLabel(result.lane);
    } catch (err) {
      warn(`could not set the label: ${err.message}`);
    }
  }
  if (gh && values.comment) {
    try {
      console.error(`risklane: PR comment ${await gh.upsertComment(markdown)}`);
    } catch (err) {
      warn(`could not post the PR comment: ${err.message}`);
    }
  }
  if (config.failOn !== "none" && RANK[result.lane] >= RANK[config.failOn]) {
    console.error(`risklane: ${result.lane} risk (${result.score}/100) meets fail-on "${config.failOn}"`);
    return 1;
  }
  return 0;
}
main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    warn(err.message ?? String(err));
    process.exit(0);
  }
);
