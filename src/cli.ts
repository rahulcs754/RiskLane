import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig, parseFailOn } from './config.js';
import { gitChurn, gitDiff, parsePatch } from './diff.js';
import { GitHub, prContext } from './github.js';
import { renderMarkdown } from './markdown.js';
import { scoreChanges } from './score.js';
import type { Lane } from './types.js';

const HELP = `risklane: rate a pull request's risk from its diff

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

const RANK: Record<Lane, number> = { low: 0, medium: 1, high: 2 };

function warn(message: string): void {
  console.error(process.env.GITHUB_ACTIONS ? `::warning title=RiskLane::${message}` : `risklane: ${message}`);
}

function setOutput(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      base: { type: 'string' },
      diff: { type: 'string' },
      config: { type: 'string', default: 'risklane.json' },
      comment: { type: 'boolean' },
      label: { type: 'boolean' },
      reviewers: { type: 'boolean' },
      'fail-on': { type: 'string' },
      json: { type: 'boolean' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help || positionals[0] !== 'check') {
    console.log(HELP);
    return values.help ? 0 : 2;
  }

  const config = loadConfig(resolve(values.config));
  if (values['fail-on']) config.failOn = parseFailOn(values['fail-on']);

  const base = values.base || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main');
  let changes;
  let churn = new Map<string, number>();
  if (values.diff) {
    changes = parsePatch(readFileSync(values.diff === '-' ? 0 : values.diff, 'utf8'));
  } else {
    changes = gitDiff(base);
    if (config.hotspots) churn = gitChurn(base, changes.map((c) => c.path));
  }

  const result = scoreChanges(changes, config, churn);
  setOutput('score', String(result.score));
  setOutput('lane', result.lane);

  const pr = prContext();
  const token = process.env.GITHUB_TOKEN;
  const gh = pr && token ? new GitHub(token, pr) : undefined;
  if ((values.comment || values.label || values.reviewers) && !gh) {
    warn(pr ? 'GITHUB_TOKEN is missing; skipping PR comment, label and reviewers.' : 'not a pull_request run; skipping PR comment, label and reviewers.');
  }

  let asked: string[] = [];
  const wanted = config.reviewers[result.lane] ?? [];
  if (gh && values.reviewers && wanted.length) {
    try {
      asked = await gh.requestReviewers(wanted);
    } catch (err) {
      warn(`could not request reviewers: ${(err as Error).message}`);
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
      warn(`could not set the label: ${(err as Error).message}`);
    }
  }
  if (gh && values.comment) {
    try {
      console.error(`risklane: PR comment ${await gh.upsertComment(markdown)}`);
    } catch (err) {
      warn(`could not post the PR comment: ${(err as Error).message}`);
    }
  }

  if (config.failOn !== 'none' && RANK[result.lane] >= RANK[config.failOn]) {
    console.error(`risklane: ${result.lane} risk (${result.score}/100) meets fail-on "${config.failOn}"`);
    return 1;
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    // Our own errors never block the PR; they show as a warning instead.
    warn((err as Error).message ?? String(err));
    process.exit(0);
  },
);
