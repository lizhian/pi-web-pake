import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import { hasReadyTauriCli } from '@/utils/tauri-cli';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.remove(directory)),
  );
});

async function fixture() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'pake-tauri-ready-'),
  );
  directories.push(directory);
  const cli = path.join(directory, 'node_modules', '@tauri-apps', 'cli');
  const entry = path.join(cli, 'tauri.js');
  const launcher = path.join(
    directory,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tauri.cmd' : 'tauri',
  );
  await fs.outputJSON(path.join(cli, 'package.json'), {
    name: '@tauri-apps/cli',
  });
  await fs.outputFile(
    entry,
    'process.exit(process.argv[2] === "--version" ? 0 : 1);',
  );
  await fs.outputFile(launcher, 'fixture');
  await fs.chmod(launcher, 0o755);
  return { directory, entry, launcher };
}

describe('Tauri CLI readiness', () => {
  it('accepts a runnable local CLI', async () => {
    const { directory } = await fixture();
    expect(await hasReadyTauriCli(directory)).toBe(true);
  });

  it('rejects a manifest without its CLI entry', async () => {
    const { directory, entry } = await fixture();
    await fs.remove(entry);
    expect(await hasReadyTauriCli(directory)).toBe(false);
  });

  it('rejects a missing native binding even when the entry exists', async () => {
    const { directory, entry } = await fixture();
    await fs.writeFile(entry, 'require("./missing-native-binding.node");');
    expect(await hasReadyTauriCli(directory)).toBe(false);
  });

  it('rejects a missing package-script launcher', async () => {
    const { directory, launcher } = await fixture();
    await fs.remove(launcher);
    expect(await hasReadyTauriCli(directory)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a non-executable launcher',
    async () => {
      const { directory, launcher } = await fixture();
      await fs.chmod(launcher, 0o644);
      expect(await hasReadyTauriCli(directory)).toBe(false);
    },
  );
});
