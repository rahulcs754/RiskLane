import { matchesAny } from './glob.js';
import {
  deletionSignal,
  dependencySignal,
  hotspotSignal,
  patternSignal,
  sensitiveSignal,
  sizeSignal,
  testSignal,
} from './signals.js';
import type { Config, FileChange, Lane, RiskResult } from './types.js';

export const PATTERN_CAP = 25;

export function laneFor(score: number, config: Config): Lane {
  if (score >= config.thresholds.high) return 'high';
  if (score >= config.thresholds.medium) return 'medium';
  return 'low';
}

export function scoreChanges(all: FileChange[], config: Config, churn = new Map<string, number>()): RiskResult {
  const ignored = all.filter((f) => matchesAny(f.path, config.ignore)).map((f) => f.path);
  const files = all.filter((f) => !ignored.includes(f.path));

  const patterns = patternSignal(files);
  // Many small pattern hits should not swamp the score on their own.
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
    ...(config.hotspots ? hotspotSignal(files, churn) : []),
  ].sort((a, b) => b.points - a.points);

  const score = Math.min(100, findings.reduce((n, f) => n + f.points, 0));
  return { score, lane: laneFor(score, config), findings, files, ignored };
}
