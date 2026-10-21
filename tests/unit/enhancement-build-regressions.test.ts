import { afterEach, describe, expect, it, vi } from 'vitest';
import WinBuilder from '../../bin/builders/WinBuilder';
import { getBuildTimeout } from '../../bin/builders/env';
import type { PakeAppOptions } from '../../bin/types';

vi.mock('@/utils/dir', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../bin/utils/dir')>()),
  npmDirectory: process.cwd(),
}));

afterEach(() => vi.unstubAllEnvs());

describe('shared build corrections retained by the fork', () => {
  it('uses the Tauri MSI ARM64 architecture label', () => {
    const builder = new WinBuilder({
      name: 'Test',
      appVersion: '1.0.0',
      installerLanguage: 'en-US',
      targets: 'arm64',
    } as PakeAppOptions);
    expect(builder.getFileName()).toBe('Test_1.0.0_arm64_en-US');
  });

  it('accepts a build timeout override and falls back for invalid values', () => {
    vi.stubEnv('PAKE_BUILD_TIMEOUT_MS', '1800000');
    expect(getBuildTimeout()).toBe(1_800_000);
    vi.stubEnv('PAKE_BUILD_TIMEOUT_MS', 'invalid');
    expect(getBuildTimeout()).toBe(900_000);
  });
});
