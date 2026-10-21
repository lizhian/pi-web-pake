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
