import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

/** The cells of a table row, split at each `|` that is not escaped as `\|`. */
function cellsOf(row: string): string[] {
  return row
    .replace(/^\|\s*|\s*\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

describe('the README table of procedures', () => {
  it('keeps the setup line of machines.join inside one cell, its pipe escaped', () => {
    const row = README.split('\n').find((line) => line.startsWith('| `machines.join`'));
    expect(row).toBeDefined();
    expect(cellsOf(row ?? '')).toHaveLength(2);
  });

  it('names the setup line with its pipe escaped', () => {
    expect(README).toContain(
      'curl -fsSL https://raw.githubusercontent.com/ThomasHendrickx/aeolus-fleet-trierarch/main/install.sh \\| sh -s -- --fleet-url <url>',
    );
  });
});
