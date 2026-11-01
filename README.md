# RiskLane

**Rate every pull request's risk, so senior reviewers spend time on the risky ones.**

AI tools make PRs faster than people can review them. Most teams review every PR the same way, so a one-line copy fix and a payment-flow rewrite both wait in the same queue. RiskLane reads each PR's diff and puts it in a lane:

| Lane | Meaning | Suggested review |
| --- | --- | --- |
| 🟢 Low | Small, safe area, tests included | One quick review |
| 🟡 Medium | Bigger change or a sensitive area | Normal review |
| 🔴 High | Auth, payments, DB migrations, infra, big diff, no tests | Senior review required |

It posts one PR comment that says **why** (each signal with its points), adds a `risk:low` / `risk:medium` / `risk:high` label, and can request senior reviewers on high-risk PRs.

No AI API key, no server, no data leaves your CI. The score is plain rules you can read and tune.

## Status

Planning. See [docs/MVP-PLAN.md](docs/MVP-PLAN.md) and [docs/RESEARCH.md](docs/RESEARCH.md). The MVP is being built in a pull request.

## License

MIT
