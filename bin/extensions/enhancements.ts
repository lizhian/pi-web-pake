import type { Command } from 'commander';
import type {
  PakeAppOptions,
  PakeTauriConfig,
  SupportedPlatform,
} from '@/types';
import {
  addManagedLocalAppOptions,
  applyManagedLocalAppConfig,
  MANAGED_LOCAL_APP_DEFAULTS,
} from './managed-local-app';
import type {
  ManagedLocalAppCliOptions,
  ManagedPakeConfig,
} from './managed-local-app/contracts';

export interface EnhancementCliOptions extends ManagedLocalAppCliOptions {
  allowOpenPath: boolean;
}

export interface EnhancementPakeConfig extends ManagedPakeConfig {
  allow_open_path?: boolean;
}

export const ENHANCEMENT_DEFAULTS = {
  ...MANAGED_LOCAL_APP_DEFAULTS,
  allowOpenPath: false,
} as const;

export function addEnhancementOptions(
  command: Command,
  defaults: EnhancementCliOptions,
): Command {
  return addManagedLocalAppOptions(command, defaults).option(
    '--allow-open-path',
    'Allow app pages to open local paths with the system default application',
    defaults.allowOpenPath,
  );
}

export function applyEnhancementConfig(
  options: PakeAppOptions,
  tauriConf: PakeTauriConfig,
  platform: SupportedPlatform,
): void {
  applyManagedLocalAppConfig(options, tauriConf, platform);
  if (options.allowOpenPath) {
    tauriConf.pake.allow_open_path = true;
  } else {
    delete tauriConf.pake.allow_open_path;
  }
}
