import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../tools/cf_build.mjs', import.meta.url));

test('Cloudflare build selects the branch mode and overrides stale environment values', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cf-build-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'bin'));
  await writeFile(path.join(dir, 'bin/npm'), `#!/usr/bin/env node
require('node:fs').writeFileSync(process.env.CAPTURE, JSON.stringify({
  args: process.argv.slice(2), site: process.env.SITE, base: process.env.BASE,
  preview: process.env.PREVIEW, cwd: process.cwd()
}));
process.exit(Number(process.env.BUILD_EXIT || 0));
`, { mode: 0o755 });
  for (const branch of ['main', 'test', 'feature/price-review', undefined]) {
    const env = {
      ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, CAPTURE: `${dir}/capture.json`,
      SITE: 'https://stale.example', BASE: '/stale/', PREVIEW: branch === 'main' ? '1' : '0',
    };
    if (branch === undefined) delete env.CF_PAGES_BRANCH;
    else env.CF_PAGES_BRANCH = branch;
    const result = spawnSync(process.execPath, [script], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const actual = JSON.parse(await readFile(env.CAPTURE, 'utf8'));
    assert.deepEqual(actual.args, ['run', branch === 'main' ? 'build' : 'build:preview']);
    assert.equal(actual.site, 'https://costco.crawlsnek.com');
    assert.equal(actual.base, '/');
    assert.equal(actual.preview, branch === 'main' ? '0' : '1');
    assert.equal(actual.cwd, path.dirname(path.dirname(script)));
    const failure = spawnSync(process.execPath, [script], { env: { ...env, BUILD_EXIT: '17' } });
    assert.equal(failure.status, 17, 'failed builds must not publish incomplete output');
  }
});
