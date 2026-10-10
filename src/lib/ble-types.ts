export type BleObservationState = 'seen' | 'not_seen' | 'unknown';
export type BleSessionState = 'waiting' | 'active' | 'closed' | 'expired';
export interface BleSummary {
  observed_seconds: number;
  not_seen_seconds: number;
  unknown_seconds: number;
  session_seconds: number;
}
export interface BleRangeDaySummary {
  summary: BleSummary;
  branches: ({ id: string; name: string } & BleSummary)[];
  truncated: boolean;
  has_ble_history: boolean;
}
export interface BleRangeSummary extends BleRangeDaySummary {
  daily?: Record<string, BleRangeDaySummary>;
}
export interface BleReportFields {
  ble_summary?: BleSummary;
  ble_branches?: ({ id: string; name: string } & BleSummary)[];
  ble_has_history?: boolean;
  ble_truncated?: boolean;
}
export interface BleBranchObservation {
  device_id: string;
  branch_id: string;
  branch_name: string;
  state: BleObservationState;
  last_observation: string | null;
  rssi: number | null;
  in_card_session: boolean;
}
export interface BlePresenceTag {
  id: number;
  address: string;
  grace_seconds: number;
  observations: BleBranchObservation[];
}
export interface BlePresenceReceiver {
  id: string;
  name: string;
  branch_id: string;
  branch_name: string;
  configured: boolean;
  receiver_state: 'ready' | 'fault' | 'stale' | 'disabled';
  state: BleObservationState;
  last_heartbeat: string | null;
}
export interface BleUserPresence {
  user: { id: number; name: string; username: string };
  tracking_mode: 'ble' | 'gps';
  server_time: string;
  business_day: { day: string; start: string; end: string; boundary: string };
  session: {
    active: boolean;
    from: string | null;
    until: string | null;
    firstArrival: string | null;
    lastDeparture: string | null;
    state: BleSessionState;
    missing_checkout: boolean;
  };
  tags: BlePresenceTag[];
  receivers: BlePresenceReceiver[];
  state: BleObservationState | 'off_shift';
  branch_id: string | null;
  branch_name: string | null;
  observed_branches: { id: string; name: string }[];
  captured_at: string | null;
  summary: BleSummary;
  branches: ({ id: string; name: string } & BleSummary)[];
  experimental: true;
  truncated: boolean;
}
