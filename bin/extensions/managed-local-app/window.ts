import type { PakeAppOptions, SupportedPlatform, WindowConfig } from '@/types';
import { MANAGED_LOCAL_APP_DEFAULTS } from './contracts';

export function buildManagedWindowConfigOverrides(
  options: PakeAppOptions,
  platform: SupportedPlatform,
): Partial<WindowConfig> {
  const overrides: Partial<WindowConfig> = {};
  if (
    platform === 'darwin' &&
    options.hideTitleBar &&
    options.trafficLightX !== undefined &&
    options.trafficLightY !== undefined
  ) {
    overrides.traffic_light_x = options.trafficLightX;
    overrides.traffic_light_y = options.trafficLightY;
  }
  if (
    options.dragRegionHeight !== MANAGED_LOCAL_APP_DEFAULTS.dragRegionHeight
  ) {
    overrides.drag_region_height = options.dragRegionHeight;
  }
  return overrides;
}
