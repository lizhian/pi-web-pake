import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createBuildPlans,
  expectedAssets,
  recipes,
} from '../../.github/scripts/managed-local-app-plan.mjs';

describe('managed local app build plans', () => {
  it('derives platform arguments and complete artifact names from app recipes', () => {
    const app = recipes.apps[0];
    expect(recipes.apps.map((recipe) => recipe.slug)).toEqual(['pi-web']);
    expect(recipes.builds).toHaveLength(6);
    for (const build of recipes.builds) {
      const plans = createBuildPlans(app, build, 'v20261021', '26.10.21');
      expect(plans.map((plan) => plan.target)).toEqual(
        build.pake_targets.split(','),
      );
      for (const plan of plans) {
        expect(plan.args[0]).toBe(app.url);
        expect(plan.args[plan.args.indexOf('--server-command') + 1]).toBe(
          app.command,
        );
        expect(plan.args[plan.args.indexOf('--identifier') + 1]).toBe(
          app.identifier,
        );
        expect(plan.args[plan.args.indexOf('--targets') + 1]).toBe(plan.target);
        const value = (flag: string) => plan.args[plan.args.indexOf(flag) + 1];
        expect(plan.args.every((arg) => typeof arg === 'string')).toBe(true);
        for (const flag of [
          '--new-window',
          '--enable-drag-drop',
          '--enable-find',
          '--wasm',
          '--json',
        ]) {
          expect(plan.args).toContain(flag);
        }
        expect(value('--safe-domain')).toBe('127.0.0.1:30141');
        expect(value('--server-port')).toBe('30141');
        expect(value('--server-timeout')).toBe('30');
        expect(value('--drag-region-height')).toBe('10');
        expect(value('--icon')).toBe(
          build.platform === 'macos'
            ? 'build/pi-web/assets/pi_web.icns'
            : 'build/pi-web/assets/pi_web.png',
        );
        expect(value('--inject')).toBe(
          'build/pi-web/scripts/pi-web-inject.css,build/pi-web/scripts/pi-web-inject.js',
        );
        for (const file of [value('--icon'), ...value('--inject').split(',')]) {
          expect(
            fs.statSync(new URL(`../../${file}`, import.meta.url)).isFile(),
          ).toBe(true);
        }
        if (build.platform === 'macos') {
          expect(value('--traffic-light-x')).toBe('11');
          expect(value('--traffic-light-y')).toBe('16');
          expect(plan.args).toContain('--camera');
          expect(plan.args).toContain('--microphone');
          expect(plan.args).not.toContain('--hide-window-decorations');
        } else {
          for (const flag of [
            '--hide-title-bar',
            '--traffic-light-x',
            '--traffic-light-y',
            '--camera',
            '--microphone',
          ]) {
            expect(plan.args).not.toContain(flag);
          }
        }
        for (const flag of [
          '--debug',
          '--iterative-build',
          '--install',
          '--system-tray',
          '--tray-icon',
        ]) {
          expect(plan.args).not.toContain(flag);
        }
        expect(plan.args).toContain(
          build.platform === 'macos'
            ? '--hide-title-bar'
            : '--hide-window-decorations',
        );
        const extension =
          build.platform === 'macos'
            ? 'dmg'
            : build.platform === 'windows'
              ? 'msi'
              : plan.target.startsWith('deb')
                ? 'deb'
                : 'AppImage';
        expect(plan.filename).toBe(
          `${app.slug}-v20261021-${build.platform}-${build.arch}.${extension}`,
        );
      }
    }
    const all = recipes.apps.flatMap((recipe) =>
      recipes.builds.flatMap((build) =>
        createBuildPlans(recipe, build, 'v20261021', '26.10.21'),
      ),
    );
    expect(all).toHaveLength(8);
    expect(expectedAssets('v20261021')).toEqual(
      all.map((plan) => plan.filename).sort(),
    );
    expect(new Set(all.map((plan) => plan.filename)).size).toBe(all.length);
  });
});
