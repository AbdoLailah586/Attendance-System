import type { ReaderDiagnostics } from './ble-types';

export const readerPingFields = `ping_id, started_at, expires_at, pong_at, diagnostics,
  CASE WHEN pong_at IS NOT NULL THEN 'answered'
       WHEN expires_at <= clock_timestamp() THEN 'timed_out'
       ELSE 'pending' END AS state`;

export function parseReaderDiagnostics(value: unknown): ReaderDiagnostics | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const uint = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
  const httpCode = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= -1000 && value <= 599;
  const rssi = data.rssi_dbm;
  const lastAck = data.nfc_last_ack_at;
  if (typeof data.firmware !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(data.firmware)
    || typeof data.reset_reason !== 'string' || !/^[a-z_]{1,24}$/.test(data.reset_reason)
    || (rssi !== null && (typeof rssi !== 'number' || !Number.isInteger(rssi) || rssi < -127 || rssi > 0))
    || !uint(data.uptime_seconds) || !uint(data.wifi_disconnects) || !uint(data.wifi_last_reason)
    || typeof data.clock_ready !== 'boolean' || typeof data.storage_ready !== 'boolean'
    || typeof data.rc522_ready !== 'boolean' || typeof data.ble_ready !== 'boolean'
    || !uint(data.nfc_queued) || !uint(data.ble_queued)
    || !httpCode(data.nfc_probe_http) || typeof data.nfc_probe_ack !== 'boolean'
    || (data.nfc_upload_http !== null && !httpCode(data.nfc_upload_http)) || typeof data.nfc_upload_ack !== 'boolean'
    || (lastAck !== null && (typeof lastAck !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(lastAck) || !Number.isFinite(Date.parse(lastAck))))) return null;
  return {
    firmware: data.firmware, uptime_seconds: data.uptime_seconds, reset_reason: data.reset_reason,
    rssi_dbm: rssi, wifi_disconnects: data.wifi_disconnects, wifi_last_reason: data.wifi_last_reason,
    clock_ready: data.clock_ready, storage_ready: data.storage_ready, rc522_ready: data.rc522_ready, ble_ready: data.ble_ready,
    nfc_queued: data.nfc_queued, ble_queued: data.ble_queued,
    nfc_probe_http: data.nfc_probe_http, nfc_probe_ack: data.nfc_probe_http === 200 && data.nfc_probe_ack,
    nfc_upload_http: data.nfc_upload_http, nfc_upload_ack: data.nfc_upload_http === 200 && data.nfc_upload_ack, nfc_last_ack_at: lastAck,
  };
}
