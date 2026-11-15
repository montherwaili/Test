import { describe, expect, it } from 'vitest';

/**
 * The simulation and the examiner must stay free of rendering, browser and UI
 * code, so they can run headless (tests, replays, scripted drives).
 * This test reads their source and fails on a forbidden import or global.
 */
const sources = import.meta.glob(['../sim/**/*.ts', '../examiner/**/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const FORBIDDEN_IMPORTS = [
  /from\s+['"]three['"]/,
  /from\s+['"]three\//,
  /from\s+['"]@dimforge\//,
  /from\s+['"](\.\.\/)+(render|ui|input|debug)\b/,
];

const FORBIDDEN_GLOBALS = [
  /\bdocument\./,
  /\bwindow\./,
  /\brequestAnimationFrame\b/,
  /\bperformance\.now\b/,
  /\bDate\.now\b/,
  /\bMath\.random\b/,
  /\blocalStorage\b/,
];

describe('architecture', () => {
  const files = Object.entries(sources).filter(([path]) => !path.includes('__tests__'));

  it('finds the sim sources', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('%s has no rendering / UI imports', (_path, code) => {
    for (const pattern of FORBIDDEN_IMPORTS) expect(code).not.toMatch(pattern);
  });

  it.each(files)('%s uses no browser globals, wall clock or unseeded randomness', (_path, code) => {
    for (const pattern of FORBIDDEN_GLOBALS) expect(code).not.toMatch(pattern);
  });
});
