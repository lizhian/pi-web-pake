import os from 'node:os';
import path from 'node:path';
import fsExtra from 'fs-extra';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAKE_OPTIONS } from '../../bin/defaults';
import { getCliProgram } from '../../bin/helpers/cli-program';
import { loadConfigFile } from '../../bin/helpers/config-file';
import {
  applyManagedLocalAppConfig,
  buildManagedWindowConfigOverrides,
  getManagedServerBuildFeatures,
  parseManagedLocalAppConfigField,
  validateManagedLocalAppOptions,
  validateServerPort,
  validateServerTimeout,
} from '../../bin/extensions/managed-local-app';
import type {
  PakeAppOptions,
  PakeCliOptions,
  PakeTauriConfig,
} from '../../bin/types';

const cliProgram = getCliProgram();
const url = 'http://127.0.0.1:8123';
function options(overrides: Partial<PakeAppOptions> = {}): PakeAppOptions {
  return { ...DEFAULT_PAKE_OPTIONS, identifier: 'com.pake.test', ...overrides };
}
const managed = () =>
  options({ serverPort: 8123, serverCommand: 'test-server' });

describe('managed local app contract', () => {
  it('leaves ordinary builds unchanged and enables the server feature only when configured', () => {
    const config = {
      app: { security: {} },
      pake: { windows: [{}] },
    } as PakeTauriConfig;
    const before = structuredClone(config);
    applyManagedLocalAppConfig(options(), config, 'darwin');
    expect(config).toEqual(before);
    expect(getManagedServerBuildFeatures(options())).toEqual([]);
    const enabled = managed();
    enabled.serverHost = validateManagedLocalAppOptions(enabled, url);
    applyManagedLocalAppConfig(enabled, config, 'darwin');
    expect(getManagedServerBuildFeatures(enabled)).toEqual(['managed-server']);
    expect(config.pake.server).toEqual({
      host: '127.0.0.1',
      port: 8123,
      command: 'test-server',
      timeout: 30,
    });
    expect(config.app.security).toEqual(before.app.security);
  });

  it('accepts the same extension values through CLI and config without changing option sources', async () => {
    const values = {
      serverPort: 8123,
      serverCommand: 'test-server',
      serverTimeout: 45,
      trafficLightX: 2,
      trafficLightY: 6,
      dragRegionHeight: 10,
    };
    const temp = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'pake-enhancement-'),
    );
    try {
      const file = path.join(temp, 'app.json');
      await fsExtra.outputJSON(file, values);
      const loaded = await loadConfigFile(
        file,
        new Set(cliProgram.options.map((option) => option.attributeName())),
      );
      cliProgram.parseOptions([
        '--server-port',
        '8123',
        '--server-command',
        'test-server',
        '--server-timeout',
        '60',
        '--traffic-light-x',
        '2',
        '--traffic-light-y',
        '6',
        '--drag-region-height',
        '10',
      ]);
      expect(loaded.options).toEqual(values);
      expect(cliProgram.opts()).toMatchObject({ ...values, serverTimeout: 60 });
      expect(cliProgram.getOptionValueSource('serverTimeout')).toBe('cli');
      const normalized = options({
        ...loaded.options,
        serverCommand: '  test-server  ',
      });
      expect(validateManagedLocalAppOptions(normalized, url)).toBe('127.0.0.1');
      expect(normalized.serverCommand).toBe('test-server');
      expect(
        validateManagedLocalAppOptions(
          options({ serverPort: 443, serverCommand: 'server' }),
          'https://[::1]',
        ),
      ).toBe('::1');
    } finally {
      await fsExtra.remove(temp);
    }
  });

  it('requires a nonempty command and port together', () => {
    for (const partial of [{ serverPort: 8123 }, { serverCommand: 'server' }]) {
      expect(() =>
        validateManagedLocalAppOptions(options(partial), url),
      ).toThrow(/must be provided together/);
    }
    expect(() =>
      validateManagedLocalAppOptions(
        options({ serverPort: 8123, serverCommand: '  ' }),
        url,
      ),
    ).toThrow(/must not be empty/);
  });

  it('rejects non-loopback targets', () => {
    expect(() =>
      validateManagedLocalAppOptions(managed(), 'https://example.com:8123'),
    ).toThrow(/loopback/);
  });

  it('rejects a target port different from the managed port', () => {
    expect(() =>
      validateManagedLocalAppOptions(managed(), 'http://localhost:8124'),
    ).toThrow(/does not match/);
  });

  it('validates extension numeric types, integer rules and ranges', () => {
    expect(() => validateServerPort('1.5')).toThrow(/between 1 and 65535/);
    expect(() => validateServerTimeout('3601')).toThrow(/between 1 and 3600/);
    expect(() => parseManagedLocalAppConfigField('serverPort', 8123.5)).toThrow(
      /must be an integer/,
    );
    expect(() =>
      parseManagedLocalAppConfigField('serverTimeout', '30'),
    ).toThrow(/must be of type number/);
    expect(() =>
      parseManagedLocalAppConfigField('dragRegionHeight', -1),
    ).toThrow(/>= 0/);
  });

  it('rejects managed service ownership with multiple app instances', () => {
    expect(() =>
      validateManagedLocalAppOptions(
        { ...managed(), multiInstance: true },
        url,
      ),
    ).toThrow(/cannot be used with --multi-instance/);
  });

  it('requires paired traffic light coordinates and applies them only to macOS overlay windows', () => {
    expect(() =>
      validateManagedLocalAppOptions(options({ trafficLightX: 2 }), url),
    ).toThrow(/must be provided together/);
    const custom = options({
      hideTitleBar: true,
      trafficLightX: 2,
      trafficLightY: 6,
    });
    expect(buildManagedWindowConfigOverrides(custom, 'darwin')).toEqual({
      traffic_light_x: 2,
      traffic_light_y: 6,
    });
    expect(buildManagedWindowConfigOverrides(custom, 'win32')).toEqual({});
    expect(
      buildManagedWindowConfigOverrides(
        { ...custom, hideTitleBar: false },
        'darwin',
      ),
    ).toEqual({});
  });
});
