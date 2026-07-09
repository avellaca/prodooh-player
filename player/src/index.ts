/**
 * Prodooh Hybrid Ad Player
 *
 * Entry point for the player application running in Chromium kiosk mode
 * on Raspberry Pi 5 devices.
 */

export const PLAYER_VERSION = '0.1.0';

export { bootPlayer } from './boot';
export type { BootResult, BootOptions, DeviceLocalConfig, BackendDeviceConfig } from './boot';
