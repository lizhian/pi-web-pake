import os from 'node:os';
import path from 'node:path';
import fsExtra from 'fs-extra';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAKE_OPTIONS } from '../../bin/defaults';
import { getCliProgram } from '../../bin/helpers/cli-program';
import { loadConfigFile } from '../../bin/helpers/config-file';
import {
  buildManagedWindowConfigOverrides,
  buildServerRemoteUrlPattern,
  validateManagedLocalAppOptions,
  validateServerPort,
  validateServerTimeout,
} from '../../bin/extensions/managed-local-app';
import type { PakeAppOptions, PakeCliOptions } from '../../bin/types';
import schema from '../../schema/pake.schema.json';

const cliProgram = getCliProgram();

function options(overrides: Partial<PakeCliOptions> = {}): PakeCliOptions {
  return { ...DEFAULT_PAKE_OPTIONS, ...overrides };
}

describe('managed local server options', () => {
  it('accepts matching loopback URLs and trims the command', () => {
    const appOptions = options({
      serverPort: 30141,
      serverCommand: '  pi-web --port 30141  ',
    });
    expect(
      validateManagedLocalAppOptions(appOptions, 'http://127.0.0.1:30141/path'),
    ).toBe('127.0.0.1');
    expect(appOptions.serverCommand).toBe('pi-web --port 30141');
  });

  it('requires port and command together', () => {
    expect(() =>
      validateManagedLocalAppOptions(
        options({ serverPort: 30141 }),
        'http://127.0.0.1:30141',
      ),
    ).toThrow(/must be provided together/);
    expect(() =>
      validateManagedLocalAppOptions(
        options({ serverCommand: 'pi-web' }),
        'http://127.0.0.1:30141',
      ),
    ).toThrow(/must be provided together/);
    expect(() =>
      validateManagedLocalAppOptions(
        options({ serverCommand: '   ' }),
        'http://127.0.0.1:30141',
      ),
    ).toThrow(/must not be empty/);
  });

  it('rejects non-loopback targets and mismatched ports', () => {
    const managed = options({
      serverPort: 30141,
      serverCommand: 'pi-web',
    });
    expect(() =>
      validateManagedLocalAppOptions(managed, 'https://example.com:30141'),
    ).toThrow(/loopback/);
    expect(() =>
      validateManagedLocalAppOptions(managed, 'http://localhost:3000'),
    ).toThrow(/does not match/);
  });

  it('rejects managed servers with multiple app instances', () => {
    expect(() =>
      validateManagedLocalAppOptions(
        options({
          serverPort: 30141,
          serverCommand: 'pi-web',
          multiInstance: true,
        }),
        'http://127.0.0.1:30141',
      ),
    ).toThrow(/cannot be used with --multi-instance/);
  });

  it('accepts default HTTP and HTTPS ports when they match', () => {
    expect(
      validateManagedLocalAppOptions(
        options({ serverPort: 80, serverCommand: 'server' }),
        'http://localhost',
      ),
    ).toBe('localhost');
    expect(
      validateManagedLocalAppOptions(
        options({ serverPort: 443, serverCommand: 'server' }),
        'https://[::1]',
      ),
    ).toBe('::1');
  });

  it('builds an exact Tauri URL pattern for the configured origin', () => {
    expect(buildServerRemoteUrlPattern('http://127.0.0.1:30141/path')).toBe(
      'http://127.0.0.1:30141/*',
    );
    expect(buildServerRemoteUrlPattern('https://localhost')).toBe(
      'https://localhost/*',
    );
    expect(buildServerRemoteUrlPattern('http://[::1]:30141')).toBe(
      'http://[\\:\\:1]:30141/*',
    );
  });

  it('registers all extension flags and validates bounded integers', () => {
    const help = cliProgram.helpInformation();
    for (const flag of [
      '--server-port',
      '--server-command',
      '--server-timeout',
      '--traffic-light-x',
      '--traffic-light-y',
      '--drag-region-height',
    ]) {
      expect(help).toContain(flag);
    }

    expect(validateServerPort('30141')).toBe(30141);
    expect(() => validateServerPort('1.5')).toThrow(/between 1 and 65535/);
    expect(validateServerTimeout('30')).toBe(30);
    expect(() => validateServerTimeout('3601')).toThrow(/between 1 and 3600/);
  });

  it('loads extension config fields with the same ranges as the schema', async () => {
    const tempDir = await fsExtra.mkdtemp(
      path.join(os.tmpdir(), 'pake-managed-config-'),
    );
    try {
      const configPath = path.join(tempDir, 'pake.json');
      await fsExtra.outputJSON(configPath, {
        serverPort: 30141,
        serverCommand: 'pi-web --port 30141',
        serverTimeout: 45,
        trafficLightX: 2,
        trafficLightY: 6,
        dragRegionHeight: 10,
      });
      const validKeys = new Set(
        cliProgram.options.map((option) => option.attributeName()),
      );
      const loaded = await loadConfigFile(configPath, validKeys);
      expect(loaded.options).toMatchObject({
        serverPort: 30141,
        serverCommand: 'pi-web --port 30141',
        serverTimeout: 45,
        trafficLightX: 2,
        trafficLightY: 6,
        dragRegionHeight: 10,
      });

      await fsExtra.outputJSON(configPath, { serverPort: 30141.5 });
      await expect(loadConfigFile(configPath, validKeys)).rejects.toThrow(
        /"serverPort" must be a finite number \(1-65535\)/,
      );
    } finally {
      await fsExtra.remove(tempDir);
    }

    expect(schema.properties.serverPort).toMatchObject({
      minimum: 1,
      maximum: 65535,
    });
    expect(schema.properties.serverTimeout).toMatchObject({
      minimum: 1,
      maximum: 3600,
    });
  });

  it('keeps default window config upstream-compatible and adds only overrides', () => {
    const defaults = options() as PakeAppOptions;
    expect(buildManagedWindowConfigOverrides(defaults, 'darwin')).toEqual({});

    const custom = options({
      hideTitleBar: true,
      trafficLightX: 2,
      trafficLightY: 6,
      dragRegionHeight: 10,
    }) as PakeAppOptions;
    expect(buildManagedWindowConfigOverrides(custom, 'darwin')).toEqual({
      traffic_light_x: 2,
      traffic_light_y: 6,
      drag_region_height: 10,
    });
    expect(buildManagedWindowConfigOverrides(custom, 'win32')).toEqual({
      drag_region_height: 10,
    });
  });
});
