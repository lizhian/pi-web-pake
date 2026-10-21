import path from 'path';
import fsExtra from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spinner = vi.hoisted(() => ({ succeed: vi.fn(), fail: vi.fn() }));
vi.mock('@/utils/info', () => ({ getSpinner: () => spinner }));
vi.mock('@/utils/platform', () => ({ IS_WIN: false }));
vi.mock('@/utils/mirror', () => ({ isCnMirrorEnabled: () => false }));
vi.mock('@/utils/shell', () => ({ shellExec: vi.fn() }));

import { shellExec } from '@/utils/shell';
import { installRust } from '@/helpers/rust';

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Rust installation failure cleanup', () => {
  it.each(['curl', 'sh'])(
    'propagates %s failure so the CLI can release its build workspace',
    async (failingExecutable) => {
      const failure = new Error('fixture installer failure');
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation(() => undefined as never);
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      let scriptPath = '';
      vi.mocked(shellExec).mockImplementation(async (command) => {
        if (command.executable === 'curl') {
          scriptPath = command.args[command.args.indexOf('-o') + 1];
          await fsExtra.writeFile(scriptPath, '# fixture only, never executed');
        }
        if (command.executable === failingExecutable) throw failure;
        return 0;
      });

      await expect(installRust()).rejects.toBe(failure);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(spinner.fail).toHaveBeenCalledOnce();
      expect(spinner.succeed).not.toHaveBeenCalled();
      expect(scriptPath).not.toBe('');
      expect(await fsExtra.pathExists(path.dirname(scriptPath))).toBe(false);
    },
  );
});
