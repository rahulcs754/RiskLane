import type { Config, Lane, RiskResult } from './types.js';

export const MARKER = '<!-- risklane -->';

export const LANE_INFO: Record<Lane, { icon: string; title: string; advice: string }> = {
  low: { icon: '🟢', title: 'Low risk', advice: 'Small change in a safe area. One quick review is enough.' },
  medium: { icon: '🟡', title: 'Medium risk', advice: 'Give this a normal, careful review.' },
  high: { icon: '🔴', title: 'High risk', advice: 'Needs a senior reviewer. Check the areas below closely before merging.' },
};

const MAX_FILES = 5;

function fileList(files: string[]): string {
  if (!files.length) return '';
  const shown = files.slice(0, MAX_FILES).map((f) => `\`${f}\``).join(', ');
  return files.length > MAX_FILES ? `${shown} +${files.length - MAX_FILES} more` : shown;
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|');
}

export function renderMarkdown(result: RiskResult, config: Config, extra: { reviewers?: string[] } = {}): string {
  const info = LANE_INFO[result.lane];
  const lines = [
    MARKER,
    `## ${info.icon} RiskLane: ${info.title} (${result.score}/100)`,
    '',
    info.advice,
    '',
  ];

  if (result.files.length === 0 && result.ignored.length === 0) {
    lines.push('No changed files found against the base branch.');
  } else if (result.files.length === 0) {
    lines.push('Only docs, assets or generated files changed, so there is nothing risky to score.');
  } else if (result.findings.length === 0) {
    lines.push('No risk signals found.');
  } else {
    lines.push('| Points | Why | Files |', '| ---: | --- | --- |');
    for (const f of result.findings) {
      lines.push(`| +${f.points} | ${escapeCell(f.reason)} | ${escapeCell(fileList(f.files))} |`);
    }
  }

  lines.push('');
  if (extra.reviewers?.length) {
    lines.push(`Requested review from ${extra.reviewers.map((r) => `@${r}`).join(', ')}.`, '');
  }
  const counted = result.files.length;
  const skipped = result.ignored.length ? `, ${result.ignored.length} ignored (docs, assets, generated)` : '';
  lines.push(
    `<sub>${counted} file(s) scored${skipped}. Lanes: low < ${config.thresholds.medium}, medium < ${config.thresholds.high}, high ≥ ${config.thresholds.high}. Tune in \`risklane.json\`. Rule-based, no code leaves CI.</sub>`,
  );
  return lines.join('\n') + '\n';
}
