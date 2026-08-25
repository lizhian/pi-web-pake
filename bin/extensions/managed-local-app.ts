import path from 'path';
import fsExtra from 'fs-extra';
import { Command, InvalidArgumentError } from 'commander';

import logger from '@/options/logger';
import { npmDirectory } from '@/utils/dir';
import { PakeError } from '@/utils/error';
import { validateNumberInput } from '@/utils/validate';
import type {
  PakeAppOptions,
  PakeCliOptions,
  PakeTauriConfig,
  SupportedPlatform,
  WindowConfig,
} from '@/types';

export interface ManagedLocalAppCliOptions {
  trafficLightX?: number;
  trafficLightY?: number;
  dragRegionHeight: number;
  serverPort?: number;
  serverCommand?: string;
  serverTimeout: number;
}

export interface ManagedLocalAppResolvedOptions {
  serverHost?: string;
}

export interface ManagedWindowConfig {
  traffic_light_x?: number;
  traffic_light_y?: number;
  drag_region_height?: number;
}

export interface ManagedServerConfig {
  host: string;
  port: number;
  command: string;
  timeout: number;
}

export interface ManagedPakeConfig {
  server?: ManagedServerConfig;
}

export const MANAGED_LOCAL_APP_DEFAULTS = {
  dragRegionHeight: 20,
  serverTimeout: 30,
} as const;

export const MANAGED_LOCAL_APP_CONFIG = {
  stringKeys: ['serverCommand'],
  integerKeys: ['serverPort', 'serverTimeout'],
  numberRanges: {
    serverPort: { min: 1, max: 65535 },
    serverTimeout: { min: 1, max: 3600 },
    trafficLightX: { min: 0 },
    trafficLightY: { min: 0 },
    dragRegionHeight: { min: 0 },
  },
} as const;

export function getManagedLocalAppConfigRule(key: string):
  | {
      type: 'string' | 'number';
      range?: { min: number; max?: number };
      integer?: boolean;
    }
  | undefined {
  if (MANAGED_LOCAL_APP_CONFIG.stringKeys.includes(key as 'serverCommand')) {
    return { type: 'string' };
  }
  const range = (
    MANAGED_LOCAL_APP_CONFIG.numberRanges as Record<
      string,
      { min: number; max?: number }
    >
  )[key];
  if (!range) return undefined;
  return {
    type: 'number',
    range,
    integer: MANAGED_LOCAL_APP_CONFIG.integerKeys.includes(
      key as 'serverPort' | 'serverTimeout',
    ),
  };
}

function validateIntegerRange(
  value: string,
  name: string,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new InvalidArgumentError(
      `${name} must be an integer between ${min} and ${max}.`,
    );
  }
  return parsed;
}

export function validateServerPort(value: string): number {
  return validateIntegerRange(value, 'Port', 1, 65535);
}

export function validateServerTimeout(value: string): number {
  return validateIntegerRange(value, 'Timeout', 1, 3600);
}

export function addManagedLocalAppOptions(
  command: Command,
  defaults: Pick<PakeCliOptions, 'dragRegionHeight' | 'serverTimeout'>,
): Command {
  return command
    .option(
      '--traffic-light-x <number>',
      'macOS traffic light horizontal position',
      validateNumberInput,
    )
    .option(
      '--traffic-light-y <number>',
      'macOS traffic light vertical position',
      validateNumberInput,
    )
    .option(
      '--drag-region-height <number>',
      'Height of the draggable top strip in pixels',
      validateNumberInput,
      defaults.dragRegionHeight,
    )
    .option(
      '--server-port <number>',
      'Local server port to probe and manage',
      validateServerPort,
    )
    .option(
      '--server-command <string>',
      'Shell command that starts the local server',
    )
    .option(
      '--server-timeout <seconds>',
      'Seconds to wait for the local server',
      validateServerTimeout,
      defaults.serverTimeout,
    );
}

export function validateManagedLocalAppOptions(
  options: PakeCliOptions,
  url: string,
): string | undefined {
  const hasTrafficLightX = options.trafficLightX !== undefined;
  const hasTrafficLightY = options.trafficLightY !== undefined;
  if (hasTrafficLightX !== hasTrafficLightY) {
    throw new PakeError(
      '--traffic-light-x and --traffic-light-y must be provided together.',
      {
        code: 'INVALID_INPUT',
        hint: 'Pass both coordinates or omit both.',
      },
    );
  }

  const hasPort = options.serverPort !== undefined;
  const hasCommand = options.serverCommand !== undefined;
  const command = options.serverCommand?.trim();

  if (hasCommand && !command) {
    throw new PakeError('--server-command must not be empty.', {
      code: 'INVALID_INPUT',
      hint: 'Pass the foreground command that starts the local web server.',
    });
  }
  if (hasPort !== hasCommand) {
    throw new PakeError(
      '--server-port and --server-command must be provided together.',
      {
        code: 'INVALID_INPUT',
        hint: 'Pass both options to manage a local server, or omit both.',
      },
    );
  }
  if (!hasPort || !command) return undefined;

  if (options.multiInstance) {
    throw new PakeError(
      '--server-port/--server-command cannot be used with --multi-instance.',
      {
        code: 'INVALID_INPUT',
        hint: 'Use the default single-instance mode so one app process owns the managed server.',
      },
    );
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new PakeError('Managed local servers require an HTTP or HTTPS URL.', {
      code: 'INVALID_INPUT',
      hint: `Use http://127.0.0.1:${options.serverPort} or an equivalent loopback URL.`,
    });
  }

  const hostname = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1', '::1'].includes(hostname)
  ) {
    throw new PakeError(
      'Managed local servers require a loopback HTTP or HTTPS URL.',
      {
        code: 'INVALID_INPUT',
        hint: `Use http://127.0.0.1:${options.serverPort}, http://localhost:${options.serverPort}, or the IPv6 loopback equivalent.`,
      },
    );
  }

  const effectivePort = target.port
    ? Number(target.port)
    : target.protocol === 'https:'
      ? 443
      : 80;
  if (effectivePort !== options.serverPort) {
    throw new PakeError(
      `Target URL port ${effectivePort} does not match --server-port ${options.serverPort}.`,
      {
        code: 'INVALID_INPUT',
        hint: 'Use the same port in the target URL and --server-port.',
      },
    );
  }

  options.serverCommand = command;
  return hostname;
}

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

type ManagedServerAppOptions = PakeAppOptions & {
  serverHost: string;
  serverPort: number;
  serverCommand: string;
};

export function hasManagedServerConfig(
  options: PakeAppOptions,
): options is ManagedServerAppOptions {
  return (
    options.serverHost !== undefined &&
    options.serverPort !== undefined &&
    Boolean(options.serverCommand)
  );
}

export function getManagedServerBuildFeatures(
  options: PakeAppOptions,
): string[] {
  return hasManagedServerConfig(options) ? ['managed-server'] : [];
}

export function buildServerRemoteUrlPattern(url: string): string {
  const target = new URL(url);
  const hostname = target.hostname.startsWith('[')
    ? target.hostname.replace(/:/g, '\\:')
    : target.hostname;
  return `${target.protocol}//${hostname}${target.port ? `:${target.port}` : ''}/*`;
}

export async function applyManagedLocalAppConfig(
  url: string,
  options: PakeAppOptions,
  tauriConf: PakeTauriConfig,
  platform: SupportedPlatform,
): Promise<void> {
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

  let capabilityPath = path.join(
    npmDirectory,
    'src-tauri',
    'capabilities',
    'default.json',
  );
  if (!(await fsExtra.pathExists(capabilityPath))) {
    capabilityPath = path.join(
      npmDirectory,
      '..',
      'src-tauri',
      'capabilities',
      'default.json',
    );
  }
  const capability = (await fsExtra.readJSON(capabilityPath)) as Record<
    string,
    unknown
  > & {
    identifier: string;
  };
  const { $schema: _schema, ...baseCapability } = capability;
  const security = (tauriConf.app.security ??= {});
  security.capabilities = [
    capability.identifier,
    {
      ...baseCapability,
      identifier: 'pake-managed-server-capability',
      description: 'Capability for the configured managed loopback server.',
      local: false,
      remote: { urls: [buildServerRemoteUrlPattern(url)] },
    },
  ];
}
