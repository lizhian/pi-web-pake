import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAKE_OPTIONS } from '../../bin/defaults';
import { getManagedServerBuildFeatures } from '../../bin/extensions/managed-local-app';
import type { PakeAppOptions } from '../../bin/types';

describe('managed server feature gate', () => {
  it('keeps the runtime and dialog plugin out of ordinary builds', () => {
    const manifest = fs.readFileSync(
      path.join(process.cwd(), 'src-tauri', 'Cargo.toml'),
      'utf8',
    );
    expect(manifest).toMatch(
      /^tauri-plugin-dialog = \{ version = "[^"]+", optional = true \}$/m,
    );
    expect(manifest).toMatch(
      /^managed-server = \["dep:libc", "dep:tauri-plugin-dialog"\]$/m,
    );

    const defaults = {
      ...DEFAULT_PAKE_OPTIONS,
      identifier: 'com.pake.test',
    } as PakeAppOptions;
    expect(getManagedServerBuildFeatures(defaults)).toEqual([]);
    expect(
      getManagedServerBuildFeatures({
        ...defaults,
        serverHost: '127.0.0.1',
        serverPort: 30141,
        serverCommand: 'server',
      }),
    ).toEqual(['managed-server']);
  });
});
