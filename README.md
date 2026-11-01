# RiskLane

**Rate every pull request's risk, so senior reviewers spend time on the risky ones.**

AI tools make PRs faster than people can review them. Most teams review every PR the same way, so a one-line copy fix and a payment-flow rewrite wait in the same queue. RiskLane reads each PR's diff and puts it in a lane:

| Lane | Score | Meaning | Suggested review |
| --- | --- | --- | --- |
| 🟢 Low | 0-29 | Small, safe area, tests included | One quick review |
| 🟡 Medium | 30-59 | Bigger change or a sensitive area | Normal review |
| 🔴 High | 60-100 | Auth, payments, DB migrations, infra, big diff, no tests | Senior review required |

On each PR it:

- posts **one comment** (updated on each push) with the score and every reason,
- sets a `risk:low` / `risk:medium` / `risk:high` label (filter your PR list by it),
- requests **senior reviewers** on high-risk PRs (optional),
- can **fail the check** on high risk (optional).

No AI API key, no server, no code leaves your CI. The score is plain rules you can read and tune.

Site: https://rahulcs754.github.io/risklane/

## Quick start

1. Add `.github/workflows/risklane.yml` (copy of [examples/workflow/risklane.yml](examples/workflow/risklane.yml)):

   ```yaml
   name: RiskLane
   on:
     pull_request:
       types: [opened, synchronize, reopened, ready_for_review]

   permissions:
     contents: read
     pull-requests: write   # comment + request reviewers
     issues: write          # labels

   jobs:
     risk:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
           with:
             fetch-depth: 0   # needed for the diff and hotspots
         - uses: rahulcs754/risklane@main
   ```

2. Optional: add `risklane.json` in the repo root to route high-risk PRs to seniors:

   ```json
   { "reviewers": { "high": ["your-senior-dev", "your-org/senior-reviewers"] } }
   ```

3. Open a PR. You get a comment like this:

   > ## 🔴 RiskLane: High risk (65/100)
   > Needs a senior reviewer. Check the areas below closely before merging.
   >
   > | Points | Why | Files |
   > | ---: | --- | --- |
   > | +20 | Sensitive area: Auth and security | `src/auth/session.ts` |
   > | +20 | Sensitive area: Database migrations and schema | `db/migrations/20261101_add_plan.sql` |
   > | +10 | SQL built from strings (injection risk) | `src/api/users.ts` |
   > | +5 | 1 source file(s) deleted | `src/old.ts` |
   > | +5 | Turns off lint or type checks | `src/api/users.ts` |
   > | +5 | Empty catch block (errors are swallowed) | `src/auth/session.ts` |

## What it checks

| Signal | Points | Notes |
| --- | --- | --- |
| Sensitive area | 5-20 each | Auth/security 20, payments/billing 20, DB migrations 20, infra/deploy 15, CI pipeline 10, app config 5. Each area counts once. |
| Diff size | 5-30 | >50 / >200 / >500 / >1000 lines. Plus 5-10 for 15+ / 40+ files. Lockfiles do not count. |
| No tests | 15 | More than 20 code lines added and no test file changed. |
| Dependencies | 4-8 | 8 for a manifest (`package.json`, `go.mod`, ...), 4 for lockfile only. |
| Deleted files | 5-10 | Deleted source files. |
| Risky code in added lines | 3-10 each, max 25 total | `eval`/`new Function`, `dangerouslySetInnerHTML`/`innerHTML`, shell exec, SQL built from strings, `eslint-disable`/`@ts-ignore`, empty `catch`, plain `http://`, TLS/CORS checks off. |
| Hotspots | 5 per file, max 10 | Files changed 10+ times in the last 90 days on the base branch. |

Score is capped at 100. Docs, images, snapshots, `dist/` and generated files are ignored.

To silence one line, add `risklane: ignore` in a comment on that line.

## Config (`risklane.json`)

All fields are optional. Full example: [examples/risklane.json](examples/risklane.json).

| Field | Default | What it does |
| --- | --- | --- |
| `thresholds` | `{ "medium": 30, "high": 60 }` | Lane cut-offs. |
| `ignore` | docs, images, `dist/`, ... | Extra globs to ignore (added to the defaults). Use `replaceIgnore` to replace them. |
| `sensitive` | 6 built-in areas | Add an area `{ "name", "paths", "points" }`, or change a built-in one by name (`"points": 0` turns it off). |
| `reviewers` | `{}` | Logins or `org/team` per lane, e.g. `{ "high": ["alice", "acme/seniors"] }`. The PR author is never requested. |
| `labels` | `true` | Set `risk:*` labels. |
| `hotspots` | `true` | Use git history for hotspots. |
| `failOn` | `"none"` | `"high"` or `"medium"` makes the check fail at that lane. |

Globs: `**` any folders, `*` any name part, a pattern with no `/` matches the file name in any folder. Case-insensitive.

## Action inputs and outputs

| Input | Default | |
| --- | --- | --- |
| `base` | `origin/<PR base>` | Ref to compare against. |
| `config` | `risklane.json` | Config path. |
| `comment` | `true` | Post or update the PR comment. |
| `label` | `true` | Set the risk label. |
| `request-reviewers` | `true` | Request the reviewers for this lane from config. |
| `fail-on` | `none` | `medium` or `high` to fail the check. |
| `github-token` | `github.token` | Token for comment, label and reviewers. |

Outputs: `score` (0-100) and `lane` (`low`, `medium`, `high`). Use them in later steps, for example to skip slow e2e tests on low-risk PRs.

Notes:

- On PRs from forks, the default token is read-only, so the comment and label are skipped with a warning. The score still shows in the job summary.
- RiskLane never fails your PR because of its own error. It prints a warning instead.

## CLI

```bash
npx github:rahulcs754/risklane check --base origin/main
git diff main...HEAD | npx github:rahulcs754/risklane check --diff -
risklane check --json         # machine-readable
risklane check --fail-on high # exit 1 on high risk
```

## Develop

```bash
npm install
npm test          # vitest
npm run typecheck
npm run build     # bundles to dist/cli.js (commit dist/ for the Action)
```

## License

MIT
