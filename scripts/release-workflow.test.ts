import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

describe('the release workflow', () => {
  it('requires the walked candidate run before downloading and verifying its tarball', () => {
    expect(workflow).toMatch(/candidate_run_id:\n\s+description:.*\n\s+required: true/);
    const walk = workflow.indexOf('node scripts/staging-walk-gate.ts');
    const download = workflow.indexOf('gh run download "$RUN_ID"');
    const verify = workflow.indexOf('node scripts/candidate-check.ts');
    expect(walk).toBeGreaterThan(0);
    expect(download).toBeGreaterThan(walk);
    expect(verify).toBeGreaterThan(download);
    expect(workflow.indexOf('npm publish --dry-run')).toBeGreaterThan(verify);
  });

  it('publishes and dry runs the downloaded candidate without rebuilding', () => {
    expect(workflow).not.toContain('npm run build');
    expect(workflow).not.toContain('npm run set-version');
    expect(workflow).not.toContain('--workspace "$PACKAGE"');
    expect(workflow).toContain('npm publish --dry-run --access public "$RUNNER_TEMP/candidate/aeolus-fleet-trierarch-plugin-$VERSION.tgz"');
    expect(workflow).toContain('npm publish --access public "$RUNNER_TEMP/candidate/aeolus-fleet-trierarch-plugin-$VERSION.tgz"');
  });
});
