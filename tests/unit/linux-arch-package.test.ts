import path from 'path';
import fsExtra from 'fs-extra';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/dir', () => ({
  npmDirectory: process.cwd(),
  tauriConfigDirectory: path.join(process.cwd(), 'src-tauri', '.pake'),
}));
vi.mock('@/utils/shell', () => ({ shellExec: vi.fn() }));

import LinuxBuilder from '@/builders/LinuxBuilder';
import { shellExec } from '@/utils/shell';
import { DEFAULT_PAKE_OPTIONS } from '@/defaults';

describe('Arch repacking workspace', () => {
  it('keeps concurrent extraction trees separate and cleans both after failure', async () => {
    const directories: string[] = [];
    let releaseExtractions: () => void = () => {};
    const bothStarted = new Promise<void>((resolve) => {
      releaseExtractions = resolve;
    });
    vi.mocked(shellExec).mockImplementation(async (command) => {
      if (command.executable === 'ar') {
        directories.push(command.cwd!);
        expect(command.args[0]).toBe('x');
        if (directories.length === 2) releaseExtractions();
        await bothStarted;
        throw new Error('fixture extraction failed');
      }
      return 0;
    });
    const makeBuilder = () => {
      const builder = new LinuxBuilder({
        ...DEFAULT_PAKE_OPTIONS,
        name: 'demo',
        targets: 'zst',
      } as any);
      vi.spyOn(builder as any, 'ensureArchPackagingTools').mockResolvedValue(
        undefined,
      );
      return builder;
    };
    const results = await Promise.allSettled([
      (makeBuilder() as any).createArchPackageFromDeb({
        removeSourceDeb: false,
      }),
      (makeBuilder() as any).createArchPackageFromDeb({
        removeSourceDeb: false,
      }),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect(directories).toHaveLength(2);
    expect(directories[0]).not.toBe(directories[1]);
    for (const directory of directories) {
      expect(await fsExtra.pathExists(path.dirname(directory))).toBe(false);
    }
  });
});
