import { Command, InvalidArgumentError } from 'commander';
import { PakeError } from '@/utils/error';
import { validateNumberInput } from '@/utils/validate';
import type { ManagedLocalAppCliOptions } from './contracts';

const MANAGED_LOCAL_APP_CONFIG = {
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

function getManagedLocalAppConfigRule(key: string):
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
  defaults: Pick<
    ManagedLocalAppCliOptions,
    'dragRegionHeight' | 'serverTimeout'
  >,
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

export function parseManagedLocalAppConfigField(
  key: string,
  value: unknown,
): { handled: false } | { handled: true; value: string | number } {
  const rule = getManagedLocalAppConfigRule(key);
  if (!rule) return { handled: false };
  if (typeof value !== rule.type) {
    throw new PakeError(`Config field "${key}" must be of type ${rule.type}.`, {
      code: 'INVALID_INPUT',
      hint: 'See schema/pake.schema.json for field types.',
    });
  }
  if (typeof value === 'number') {
    const min = rule.range?.min ?? 0;
    const max = rule.range?.max;
    if (
      !Number.isFinite(value) ||
      (rule.integer && !Number.isInteger(value)) ||
      value < min ||
      (max !== undefined && value > max)
    ) {
      const bounds = max !== undefined ? `${min}-${max}` : `>= ${min}`;
      const kind = rule.integer ? 'an integer' : 'a finite number';
      throw new PakeError(
        `Config field "${key}" must be ${kind} (${bounds}).`,
        {
          code: 'INVALID_INPUT',
          hint: 'See schema/pake.schema.json for field ranges.',
        },
      );
    }
  }
  return { handled: true, value: value as string | number };
}
