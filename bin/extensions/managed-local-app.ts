import logger from '@/options/logger';
import type {
  PakeAppOptions,
  PakeTauriConfig,
  SupportedPlatform,
} from '@/types';
import { hasManagedServerConfig } from './managed-local-app/server';
import { buildManagedWindowConfigOverrides } from './managed-local-app/window';

export { MANAGED_LOCAL_APP_DEFAULTS } from './managed-local-app/contracts';
export {
  addManagedLocalAppOptions,
  parseManagedLocalAppConfigField,
  validateServerPort,
  validateServerTimeout,
} from './managed-local-app/options';
export {
  validateManagedLocalAppOptions,
  getManagedServerBuildFeatures,
} from './managed-local-app/server';
export { buildManagedWindowConfigOverrides } from './managed-local-app/window';

export function applyManagedLocalAppConfig(
  options: PakeAppOptions,
  tauriConf: PakeTauriConfig,
  platform: SupportedPlatform,
): void {
  if (options.trafficLightX !== undefined) {
    if (platform !== 'darwin') {
      logger.warn(
        '✼ --traffic-light-x/--traffic-light-y are only supported on macOS and will be ignored on this platform.',
      );
    } else if (!options.hideTitleBar) {
      logger.warn(
        '✼ --traffic-light-x/--traffic-light-y require --hide-title-bar and will be ignored.',
      );
    }
  }
  Object.assign(
    tauriConf.pake.windows[0],
    buildManagedWindowConfigOverrides(options, platform),
  );

  if (!hasManagedServerConfig(options)) {
    delete tauriConf.pake.server;
    return;
  }

  tauriConf.pake.server = {
    host: options.serverHost,
    port: options.serverPort,
    command: options.serverCommand,
    timeout: options.serverTimeout,
  };
}
