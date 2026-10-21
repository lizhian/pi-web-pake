import { PakeError } from '@/utils/error';
import type { PakeAppOptions, PakeCliOptions } from '@/types';

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
