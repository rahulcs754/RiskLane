import { readFileSync } from 'node:fs';
import { MARKER } from './markdown.js';
import type { Lane } from './types.js';

export interface PrContext {
  owner: string;
  repo: string;
  number: number;
  author?: string;
  apiUrl: string;
}

/** PR details from the GitHub Actions environment, or undefined outside a PR. */
export function prContext(env: NodeJS.ProcessEnv = process.env): PrContext | undefined {
  const [owner, repo] = (env.GITHUB_REPOSITORY ?? '').split('/');
  if (!owner || !repo || !env.GITHUB_EVENT_PATH) return undefined;
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as {
    pull_request?: { number?: number; user?: { login?: string } };
  };
  const number = event.pull_request?.number;
  if (typeof number !== 'number') return undefined;
  return { owner, repo, number, author: event.pull_request?.user?.login, apiUrl: env.GITHUB_API_URL ?? 'https://api.github.com' };
}

export class GitHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type Fetch = typeof fetch;

export class GitHub {
  private readonly base: string;
  constructor(private readonly token: string, private readonly pr: PrContext, private readonly fetchFn: Fetch = fetch) {
    this.base = `${pr.apiUrl}/repos/${pr.owner}/${pr.repo}`;
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
      },
    });
    if (!res.ok) throw new GitHubError(`GitHub API ${init.method ?? 'GET'} ${path} failed: ${res.status}`, res.status);
    return res;
  }

  /** Create our PR comment, or update it if we posted one before. */
  async upsertComment(body: string): Promise<'created' | 'updated'> {
    for (let page = 1; page <= 10; page++) {
      const res = await this.call(`/issues/${this.pr.number}/comments?per_page=100&page=${page}`);
      const comments = (await res.json()) as Array<{ id: number; body?: string }>;
      const ours = comments.find((c) => c.body?.includes(MARKER));
      if (ours) {
        await this.call(`/issues/comments/${ours.id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
        return 'updated';
      }
      if (comments.length < 100) break;
    }
    await this.call(`/issues/${this.pr.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    return 'created';
  }

  /** Put exactly one `risk:<lane>` label on the PR. */
  async setLaneLabel(lane: Lane): Promise<void> {
    const want = `risk:${lane}`;
    const res = await this.call(`/issues/${this.pr.number}/labels?per_page=100`);
    const current = ((await res.json()) as Array<{ name: string }>).map((l) => l.name);
    for (const name of current) {
      if (name.startsWith('risk:') && name !== want) {
        await this.call(`/issues/${this.pr.number}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' });
      }
    }
    if (current.includes(want)) return;
    await this.ensureLabel(want, LABEL_COLORS[lane]);
    await this.call(`/issues/${this.pr.number}/labels`, { method: 'POST', body: JSON.stringify({ labels: [want] }) });
  }

  private async ensureLabel(name: string, color: string): Promise<void> {
    try {
      await this.call('/labels', {
        method: 'POST',
        body: JSON.stringify({ name, color, description: 'Set by RiskLane' }),
      });
    } catch (err) {
      // 422 = label already exists.
      if (!(err instanceof GitHubError && err.status === 422)) throw err;
    }
  }

  /** Request reviews. "org/team" entries become team reviewers. Returns who was asked. */
  async requestReviewers(list: string[]): Promise<string[]> {
    const author = this.pr.author?.toLowerCase();
    const users = list.filter((r) => !r.includes('/') && r.toLowerCase() !== author);
    const teams = list.filter((r) => r.includes('/')).map((r) => r.split('/')[1]!);
    if (!users.length && !teams.length) return [];
    await this.call(`/pulls/${this.pr.number}/requested_reviewers`, {
      method: 'POST',
      body: JSON.stringify({ reviewers: users, team_reviewers: teams }),
    });
    return [...users, ...list.filter((r) => r.includes('/'))];
  }
}

export const LABEL_COLORS: Record<Lane, string> = { low: '2da44e', medium: 'd4a72c', high: 'cf222e' };
