const cache = new Map<string, RegExp>();

/**
 * Small glob matcher: `**` any folders, `*` any chars except "/", `?` one char.
 * A pattern with no "/" matches the file name in any folder (like .gitignore).
 * Matching ignores case.
 */
export function globToRegExp(pattern: string): RegExp {
  const hit = cache.get(pattern);
  if (hit) return hit;
  let p = pattern.replace(/^\.\//, '');
  if (!p.includes('/')) p = `**/${p}`;
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const out = new RegExp(`^${re}$`, 'i');
  cache.set(pattern, out);
  return out;
}

export function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(path));
}
