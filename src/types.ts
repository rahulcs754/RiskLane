export type Lane = 'low' | 'medium' | 'high';

export interface FileChange {
  path: string;
  /** Path before a rename, if renamed. */
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  binary: boolean;
  additions: number;
  deletions: number;
  /** Text of added lines (without the leading "+"). */
  addedLines: string[];
}

export interface Finding {
  /** Stable id, e.g. "size" or "sensitive:auth". */
  id: string;
  points: number;
  reason: string;
  files: string[];
}

export interface SensitiveRule {
  name: string;
  paths: string[];
  points: number;
}

export interface Config {
  thresholds: { medium: number; high: number };
  ignore: string[];
  sensitive: SensitiveRule[];
  reviewers: Partial<Record<Lane, string[]>>;
  labels: boolean;
  hotspots: boolean;
  failOn: Lane | 'none';
}

export interface RiskResult {
  score: number;
  lane: Lane;
  findings: Finding[];
  /** Files that counted (not ignored). */
  files: FileChange[];
  ignored: string[];
}
