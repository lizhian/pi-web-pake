import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAKE_OPTIONS } from '../../bin/defaults';
import { loadConfigFile } from '../../bin/helpers/config-file';
import {
  addEnhancementOptions,
  applyEnhancementConfig,
} from '../../bin/extensions/enhancements';
import type { PakeAppOptions, PakeTauriConfig } from '../../bin/types';

describe('open-path enhancement', () => {
  it('defaults off and preserves CLI sources, config booleans and type validation', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'pake-open-config-'),
    );
    const configPath = path.join(directory, 'app.json');
    try {
      for (const enabled of [false, true]) {
        const command = addEnhancementOptions(
          new Command(),
          DEFAULT_PAKE_OPTIONS,
        );
        command.parse(enabled ? ['--allow-open-path'] : [], { from: 'user' });
        expect(command.opts().allowOpenPath).toBe(enabled);
        expect(command.getOptionValueSource('allowOpenPath')).toBe(
          enabled ? 'cli' : 'default',
        );
        expect(command.helpInformation()).toContain('--allow-open-path');
        const validKeys = new Set(
          command.options.map((option) => option.attributeName()),
        );
        await fs.writeFile(
          configPath,
          JSON.stringify({ allowOpenPath: enabled }),
        );
        const loaded = await loadConfigFile(configPath, validKeys);
        expect(loaded.options.allowOpenPath).toBe(enabled);
      }
      await fs.writeFile(configPath, JSON.stringify({ allowOpenPath: 'true' }));
      await expect(
        loadConfigFile(configPath, new Set(['allowOpenPath'])),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('maps the opt-in independently of managed servers and clears stale grants', () => {
    const config = { pake: { windows: [{}] } } as PakeTauriConfig;
    const options: PakeAppOptions = {
      ...DEFAULT_PAKE_OPTIONS,
      identifier: 'com.pake.any-app',
    };
    const baseline = structuredClone(config);
    applyEnhancementConfig(options, config, 'darwin');
    expect(config).toEqual(baseline);
    applyEnhancementConfig(
      { ...options, allowOpenPath: true },
      config,
      'linux',
    );
    expect(config.pake).toEqual({ windows: [{}], allow_open_path: true });
    applyEnhancementConfig(options, config, 'win32');
    expect(config).toEqual(baseline);
  });
});
