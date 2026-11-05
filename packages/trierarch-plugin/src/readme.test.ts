import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { setupLineOf } from './core/machines/setup-line.js';

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

  it('names the setup line the plugin builds, up to its placeholders', () => {
    const line = setupLineOf({ fleetUrl: '<url>', shipId: '<id>' as never, pluginShipId: '<its own ship>' as never, secret: '<secret>' });
    expect(README).toContain(line.replace('|', '\\|'));
  });
});
