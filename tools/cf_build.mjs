import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Missing branch information is a preview, never an accidental public build.
const production = process.env.CF_PAGES_BRANCH === 'main';
const result = spawnSync('npm', ['run', production ? 'build' : 'build:preview'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  stdio: 'inherit',
  env: {
    ...process.env,
    SITE: 'https://costco.crawlsnek.com',
    BASE: '/',
    PREVIEW: production ? '0' : '1',
  },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
