import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, parseConfig } from '../src/config.js';

describe('parseConfig', () => {
  it('returns defaults for {}', () => {
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it('changes points of a built-in area by name', () => {
    const c = parseConfig({ sensitive: [{ name: 'app and build config', points: 0 }] });
    expect(c.sensitive.find((s) => s.name === 'App and build config')?.points).toBe(0);
    expect(DEFAULT_CONFIG.sensitive.find((s) => s.name === 'App and build config')?.points).toBe(5);
  });

  it('adds ignore globs to the defaults', () => {
    const c = parseConfig({ ignore: ['fixtures/**'] });
    expect(c.ignore).toContain('fixtures/**');
    expect(c.ignore).toContain('*.md');
  });

  it('reads reviewers, labels, hotspots, failOn', () => {
    const c = parseConfig({ reviewers: { high: ['alice', 'acme/seniors'] }, labels: false, hotspots: false, failOn: 'high' });
    expect(c).toMatchObject({ reviewers: { high: ['alice', 'acme/seniors'] }, labels: false, hotspots: false, failOn: 'high' });
  });

  it.each([
    [[], 'must be a JSON object'],
    [{ thresholds: { medium: 70, high: 50 } }, 'thresholds.medium must be <= thresholds.high'],
    [{ thresholds: { high: 101 } }, 'thresholds.high must be a number 0-100'],
    [{ reviewers: { urgent: ['a'] } }, 'lane must be low, medium or high'],
    [{ sensitive: [{ name: 'X', points: 5 }] }, 'sensitive[0].paths must be an array of strings'],
    [{ failOn: 'yes' }, 'failOn must be'],
  ])('rejects %j', (raw, msg) => {
    expect(() => parseConfig(raw)).toThrow(msg);
  });
});
