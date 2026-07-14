/**
 * HeartbeatService — sends periodic heartbeat with device status to the backend.
 * Processes pending commands from heartbeat response (e.g., screenshot requests).
 *
 * Validates: Requirements 8.1, 22.1
 */

import type { BackendApiClient, HttpResponse } from '../api/BackendApiClient';
import type { SourceType } from '../sources/types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StorageStatus {
  total_mb: number;
  available_mb: number;
  percent_used: number;
}

export interface CurrentContent {
  id: string;
  source: SourceType;
}

export interface HeartbeatRequest {
  venue_id: string;
  timestamp: string; // ISO 8601
  current_content: CurrentContent | null;
  storage: StorageStatus;
  uptime_seconds: number;
  playlist_version: string;
}

export interface DeviceCommand {
  id: string;
  type: 'screenshot' | 'config_update' | 'playlist_update' | 'speed_override' | 'preview_content';
  payload: Record<string, unknown>;
}

export interface HeartbeatResponse {
  ack: true;
  pending_commands: DeviceCommand[];
}

/**
 * Provider interface for device status information.
 * The HeartbeatService queries this to build heartbeat payloads.
 */
export interface DeviceStatusProvider {
  /** Returns the venue_id for this device */
  getVenueId(): string;

  /** Returns currently playing content, or null if idle */
  getCurrentContent(): CurrentContent | null;

  /** Returns current storage status */
  getStorageStatus(): StorageStatus;

  /** Returns device uptime in seconds */
  getUptimeSeconds(): number;

  /** Returns the current playlist version string */
  getPlaylistVersion(): string;
}

/**
 * Handler for processing commands received in heartbeat responses.
 */
export interface CommandHandler {
  handleCommand(command: DeviceCommand): Promise<void>;
}

export interface HeartbeatServiceOptions {
  /** The HTTP client (already authenticated with Bearer token) */
  client: BackendApiClient;

  /** Provider of device status information */
  statusProvider: DeviceStatusProvider;

  /** Handler for processing pending commands */
  commandHandler?: CommandHandler;

  /** Interval between heartbeats in milliseconds (default: 60000) */
  intervalMs?: number;
}

// ─── HeartbeatService ────────────────────────────────────────────────────────

export class HeartbeatService {
  private client: BackendApiClient;
  private statusProvider: DeviceStatusProvider;
  private commandHandler: CommandHandler | null;
  private intervalMs: number;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private _isRunning = false;

  constructor(options: HeartbeatServiceOptions) {
    this.client = options.client;
    this.statusProvider = options.statusProvider;
    this.commandHandler = options.commandHandler ?? null;
    this.intervalMs = options.intervalMs ?? 60_000;
  }

  /** Start sending periodic heartbeats */
  start(): void {
    if (this._isRunning) return;
    this._isRunning = true;

    // Send first heartbeat immediately
    this.sendHeartbeat();

    // Schedule subsequent heartbeats
    this.timerId = setInterval(() => {
      this.sendHeartbeat();
    }, this.intervalMs);
  }

  /** Stop sending heartbeats */
  stop(): void {
    this._isRunning = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /** Whether the service is currently running */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Send a single heartbeat to the backend.
   * Returns the list of pending commands on success, or null on failure.
   * Processes commands via the registered handler automatically.
   */
  async sendHeartbeat(): Promise<DeviceCommand[] | null> {
    const request: HeartbeatRequest = {
      venue_id: this.statusProvider.getVenueId(),
      timestamp: new Date().toISOString(),
      current_content: this.statusProvider.getCurrentContent(),
      storage: this.statusProvider.getStorageStatus(),
      uptime_seconds: this.statusProvider.getUptimeSeconds(),
      playlist_version: this.statusProvider.getPlaylistVersion(),
    };

    const response: HttpResponse<HeartbeatResponse> = await this.client.post<HeartbeatResponse>(
      '/api/device/heartbeat',
      request,
    );

    if (!response.ok || !response.data) {
      return null;
    }

    const commands = response.data.pending_commands;

    // Process pending commands
    if (commands.length > 0 && this.commandHandler) {
      await this.processCommands(commands);
    }

    return commands;
  }

  /** Update the heartbeat interval (useful when config changes) */
  setInterval(intervalMs: number): void {
    this.intervalMs = intervalMs;

    // If currently running, restart with new interval
    if (this._isRunning) {
      this.stop();
      this.start();
    }
  }

  private async processCommands(commands: DeviceCommand[]): Promise<void> {
    if (!this.commandHandler) return;

    for (const command of commands) {
      try {
        await this.commandHandler.handleCommand(command);
      } catch {
        // Command processing failures are non-fatal;
        // the backend will resend unacknowledged commands on next heartbeat
      }
    }
  }
}
