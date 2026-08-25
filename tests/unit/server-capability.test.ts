import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyManagedLocalAppConfig } from '../../bin/extensions/managed-local-app';
import type { PakeAppOptions, PakeTauriConfig } from '../../bin/types';

describe('managed server capability', () => {
  it('keeps loopback URLs out of the default capability', () => {
    const capability = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'src-tauri', 'capabilities', 'default.json'),
        'utf8',
      ),
    );

    expect(capability.remote.urls).toEqual(['https://*.*']);
  });

  it('adds only the configured loopback origin to managed builds', async () => {
    const tauriConf = {
      app: { security: {} },
      pake: { windows: [{}] },
    } as PakeTauriConfig;
    await applyManagedLocalAppConfig(
      'http://127.0.0.1:30141/path',
      {
        serverHost: '127.0.0.1',
        serverPort: 30141,
        serverCommand: 'server',
        serverTimeout: 30,
        dragRegionHeight: 20,
      } as PakeAppOptions,
      tauriConf,
      'darwin',
    );

    expect(tauriConf.app.security?.capabilities?.[0]).toBe('pake-capability');
    expect(tauriConf.app.security?.capabilities?.[1]).toMatchObject({
      identifier: 'pake-managed-server-capability',
      local: false,
      remote: { urls: ['http://127.0.0.1:30141/*'] },
    });
  });

  it('does not add explicit capabilities to ordinary builds', async () => {
    const tauriConf = {
      app: { security: {} },
      pake: { windows: [{}] },
    } as PakeTauriConfig;
    await applyManagedLocalAppConfig(
      'https://example.com',
      { dragRegionHeight: 20 } as PakeAppOptions,
      tauriConf,
      'darwin',
    );
    expect(tauriConf.app.security?.capabilities).toBeUndefined();
  });
});
