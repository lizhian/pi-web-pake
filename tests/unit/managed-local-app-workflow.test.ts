import { describe, expect, it } from 'vitest';
import {
  createBuildPlans,
  expectedAssets,
  recipes,
} from '../../.github/scripts/managed-local-app-plan.mjs';

describe('managed local app build plans', () => {
  it('derives platform arguments and complete artifact names from app recipes', () => {
    const app = {
      ...recipes.apps[0],
      slug: 'fixture-app',
      name: 'Fixture',
      identifier: 'com.pake.fixture',
      url: 'http://127.0.0.1:8123',
      port: '8123',
      command: 'test-server',
      dragRegionHeight: '10',
    };
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
          `fixture-app-v20261021-${build.platform}-${build.arch}.${extension}`,
        );
      }
    }
    const all = recipes.apps.flatMap((recipe) =>
      recipes.builds.flatMap((build) =>
        createBuildPlans(recipe, build, 'v20261021', '26.10.21'),
      ),
    );
    expect(expectedAssets('v20261021')).toEqual(
      all.map((plan) => plan.filename).sort(),
    );
    expect(new Set(all.map((plan) => plan.filename)).size).toBe(all.length);
  });
});
