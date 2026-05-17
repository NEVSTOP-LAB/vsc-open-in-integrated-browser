import { defineConfig } from '@vscode/test-cli';
import os from 'os';
import path from 'path';

const tempRoot = path.join(os.tmpdir(), 'vsc-open-in-integrated-browser-test');

export default defineConfig({
  files: 'out/test/**/*.test.js',
  launchArgs: [
    `--user-data-dir=${path.join(tempRoot, 'user-data')}`,
    `--extensions-dir=${path.join(tempRoot, 'extensions')}`,
  ],
  mocha: {
    ui: 'tdd',
    timeout: 20000,
  },
});
