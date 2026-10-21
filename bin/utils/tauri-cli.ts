import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';

/** Check the local launcher and native binding, not just an installed manifest. */
export async function hasReadyTauriCli(directory: string): Promise<boolean> {
  const modules = path.join(directory, 'node_modules');
  const launcher = path.join(
    modules,
    '.bin',
    process.platform === 'win32' ? 'tauri.cmd' : 'tauri',
  );
  const entry = path.join(modules, '@tauri-apps', 'cli', 'tauri.js');
  try {
    await fs.access(
      launcher,
      process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK,
    );
    await execa(process.execPath, [entry, '--version'], {
      cwd: directory,
      stdio: 'ignore',
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}
