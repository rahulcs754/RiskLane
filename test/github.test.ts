import { describe, expect, it } from 'vitest';
import { GitHub, type PrContext } from '../src/github.js';
import { MARKER } from '../src/markdown.js';

const pr: PrContext = { owner: 'o', repo: 'r', number: 7, author: 'dev', apiUrl: 'https://api.test' };

function fake(responses: Record<string, unknown>) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('https://api.test/repos/o/r', '');
    calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined });
    const key = `${method} ${path.split('?')[0]}`;
    const res = responses[key];
    if (typeof res === 'number') return new Response('{}', { status: res });
    return new Response(JSON.stringify(res ?? {}), { status: 200 });
  }) as typeof fetch;
  return { fn, calls };
}

describe('GitHub', () => {
  it('updates our old comment instead of adding a new one', async () => {
    const { fn, calls } = fake({ 'GET /issues/7/comments': [{ id: 1, body: 'hi' }, { id: 2, body: `${MARKER}\nold` }] });
    expect(await new GitHub('t', pr, fn).upsertComment('new')).toBe('updated');
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/issues/comments/2' });
  });

  it('swaps risk labels and creates the label if missing', async () => {
    const { fn, calls } = fake({ 'GET /issues/7/labels': [{ name: 'risk:low' }, { name: 'bug' }], 'POST /labels': 422 });
    await new GitHub('t', pr, fn).setLaneLabel('high');
    expect(calls.map((c) => `${c.method} ${c.path.split('?')[0]}`)).toEqual([
      'GET /issues/7/labels',
      'DELETE /issues/7/labels/risk%3Alow',
      'POST /labels',
      'POST /issues/7/labels',
    ]);
  });

  it('requests users and teams, never the PR author', async () => {
    const { fn, calls } = fake({});
    const asked = await new GitHub('t', pr, fn).requestReviewers(['alice', 'Dev', 'acme/seniors']);
    expect(asked).toEqual(['alice', 'acme/seniors']);
    expect(calls[0]?.body).toEqual({ reviewers: ['alice'], team_reviewers: ['seniors'] });
  });
});
