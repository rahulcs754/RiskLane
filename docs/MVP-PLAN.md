# MVP plan

## Goal

A GitHub Action (and CLI) that scores a PR's risk from 0 to 100 using only the git diff, explains the score, and labels the PR low / medium / high.

## How it works

1. Get the diff between the PR base and head (`git diff --numstat` and the patch).
2. Run rule-based signals. Each one adds points and a short reason:
   - **Size**: lines changed and files changed.
   - **Sensitive paths**: auth, payments, security, DB migrations, infra (Terraform, Docker, k8s), CI workflows. Path globs with weights, tunable in config.
   - **Dependencies**: package manifest or lockfile changed.
   - **No tests**: source code changed but no test file changed.
   - **Deleted files**.
   - **Risky patterns in added lines**: `eval`, `dangerouslySetInnerHTML`, `child_process` exec, raw SQL built with strings, disabled lint or type checks, empty `catch`, hard-coded `http://`.
   - **Hotspots** (optional, needs full history): files that changed many times in the last 90 days.
3. Sum points (cap 100). Lane: low < 30, medium 30-59, high >= 60 (tunable).
4. Output:
   - One sticky PR comment: score, lane, table of reasons, top risky files.
   - Label `risk:low|medium|high` (old risk labels removed).
   - Optional: request reviewers from `reviewers.high` in config.
   - Job summary + action outputs `score` and `lane`.
   - Optional `fail-on: high` to block merge until a senior approves.

## Config

`risklane.json` in the repo root (all optional): thresholds, extra sensitive paths with weights, ignore globs (docs, generated files), reviewers per lane, labels on/off.

## Not in MVP

- AI/LLM review of the code.
- Learning from past incidents or reverts.
- GitLab / Bitbucket.

## Done when

- Works on a real PR in a demo repo: comment, label, outputs.
- Unit tests for each signal and the scoring.
- README how-to and a GitHub Pages site.
