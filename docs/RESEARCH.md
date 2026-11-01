# Research notes

Why this tool, in short (from the Nov 2026 market research round).

## The problem

- AI coding tools raised PR volume a lot. Review is now the bottleneck: in Qodo's 2026 survey, verifying AI code was the top blocker for 26% of teams, and 89% had at least one production incident from AI-written code.
- Teams review every PR the same way. Seniors burn time on trivial PRs, and risky PRs get the same tired, quick "LGTM".
- Risk is mostly predictable from the diff: what area it touches (auth, payments, migrations, infra), how big it is, whether tests changed, and new risky code patterns.

## Existing options

- CODEOWNERS: routes by path, but no size or test signal and no "how risky" score.
- AI review bots (CodeRabbit, Copilot review, Qodo): comment on code, but do not triage which PRs need a senior. Paid, and send code to a third party.
- LinearB / gitStream: has risk-style rules, but it is a bigger platform with its own rule language.

## Gap

A free, open source, zero-config GitHub Action that gives each PR a clear, explainable risk lane, and routes only high-risk PRs to seniors.

## Users

Tech leads and senior devs on teams of 5 to 50 who use AI coding tools and feel the review queue pain.
