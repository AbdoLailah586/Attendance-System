import type { BleRangeDaySummary, BleReportFields } from './ble-types';

// Keep card/GPS payroll fields unchanged. BLE observations are separate evidence.
export function bleReportFields(range?: BleRangeDaySummary): BleReportFields {
  return {
    ble_summary: range?.summary ?? { observed_seconds: 0, not_seen_seconds: 0, unknown_seconds: 0, session_seconds: 0 },
    ble_branches: range?.branches ?? [],
    ble_has_history: range?.has_ble_history ?? false,
    ble_truncated: range?.truncated ?? false,
  };
}
