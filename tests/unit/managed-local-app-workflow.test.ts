import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type BuildPlan = {
  app: string;
  platform: string;
  architecture: string;
  target: string;
  args: string[];
};

const scriptPath = path.join(
  process.cwd(),
  '.github',
  'scripts',
  'build-managed-local-apps.mjs',
);

function plans(
  app: string,
  platform: string,
  architecture: string,
  targets: string,
): BuildPlan[] {
  const output = execFileSync(process.execPath, [scriptPath, '--plan'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PAKE_BUILD_APP: app,
      PAKE_BUILD_PLATFORM: platform,
      PAKE_BUILD_ARCH: architecture,
      PAKE_BUILD_TARGETS: targets,
      PAKE_RELEASE_TAG: 'v20260825',
      PAKE_APP_VERSION: '26.8.25',
    },
  });
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BuildPlan);
}

function argumentValue(plan: BuildPlan, flag: string): string | undefined {
  const index = plan.args.indexOf(flag);
  return index >= 0 ? plan.args[index + 1] : undefined;
}

describe('managed local app release workflow', () => {
  it('plans all 16 release assets across native x64 and ARM64 runners', () => {
    const matrix = ['deepseek-harness', 'pi-web'].flatMap((app) => [
      ...plans(app, 'macos', 'x64', 'intel'),
      ...plans(app, 'macos', 'arm64', 'apple'),
      ...plans(app, 'windows', 'x64', 'x64'),
      ...plans(app, 'windows', 'arm64', 'arm64'),
      ...plans(app, 'linux', 'x64', 'deb,appimage'),
      ...plans(app, 'linux', 'arm64', 'deb-arm64,appimage-arm64'),
    ]);

    expect(matrix).toHaveLength(16);
    expect(new Set(matrix.map((plan) => plan.app))).toEqual(
      new Set(['deepseek-harness', 'pi-web']),
    );
    expect(new Set(matrix.map((plan) => plan.target))).toEqual(
      new Set([
        'intel',
        'apple',
        'x64',
        'arm64',
        'deb',
        'appimage',
        'deb-arm64',
        'appimage-arm64',
      ]),
    );
  });

  it('uses the managed server commands, identifiers, and plain loopback URLs', () => {
    const [deepseek] = plans('deepseek-harness', 'macos', 'arm64', 'apple');
    const [piWeb] = plans('pi-web', 'macos', 'arm64', 'apple');

    expect(deepseek.args[0]).toBe('http://127.0.0.1:3080');
    expect(argumentValue(deepseek, '--identifier')).toBe('com.lizhian.dshweb');
    expect(argumentValue(deepseek, '--server-command')).toBe(
      'dsh --profile web --no-open --host 127.0.0.1 --port 3080',
    );
    expect(argumentValue(deepseek, '--drag-region-height')).toBe('20');

    expect(piWeb.args[0]).toBe('http://127.0.0.1:30141');
    expect(argumentValue(piWeb, '--identifier')).toBe('com.lizhian.piweb');
    expect(argumentValue(piWeb, '--server-command')).toBe(
      'pi-web --hostname 127.0.0.1 --port 30141 --no-open',
    );
    expect(argumentValue(piWeb, '--drag-region-height')).toBe('10');
  });

  it('uses ICNS on macOS and frameless PNG builds on Windows and Linux', () => {
    const [mac] = plans('deepseek-harness', 'macos', 'x64', 'intel');
    expect(argumentValue(mac, '--icon')).toMatch(/\.icns$/);
    expect(mac.args).toContain('--hide-title-bar');
    expect(mac.args).toContain('--traffic-light-x');
    expect(mac.args).not.toContain('--hide-window-decorations');

    for (const platform of ['windows', 'linux']) {
      const target = platform === 'windows' ? 'arm64' : 'deb-arm64';
      const [desktop] = plans('deepseek-harness', platform, 'arm64', target);
      expect(argumentValue(desktop, '--icon')).toMatch(/\.png$/);
      expect(desktop.args).toContain('--hide-window-decorations');
      expect(desktop.args).not.toContain('--traffic-light-x');
    }
  });

  it('stays manual-only and uses native hosted ARM runners', () => {
    const workflow = fs.readFileSync(
      path.join(
        process.cwd(),
        '.github',
        'workflows',
        'managed-local-apps.yml',
      ),
      'utf8',
    );

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).toContain('windows-11-arm');
    expect(workflow).toContain('ubuntu-24.04-arm');
    expect(workflow).toContain('macos-15-intel');
    expect(workflow).toContain('macos-15');
  });

  it('isolates each app job and installs portable cross-platform build prerequisites', () => {
    const workflow = fs.readFileSync(
      path.join(
        process.cwd(),
        '.github',
        'workflows',
        'managed-local-apps.yml',
      ),
      'utf8',
    );

    expect(workflow).toContain('app: [deepseek-harness, pi-web]');
    expect(workflow).toContain('PAKE_BUILD_APP: ${{ matrix.app }}');
    expect(workflow).toContain('wix311-binaries.zip');
    expect(workflow).toContain('Expand-Archive');
    expect(workflow).not.toContain('Start-Process');
    expect(workflow).toContain('xdg-utils');
  });
});
