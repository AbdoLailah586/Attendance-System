import { query } from './db';

export interface StoreRouter {
  id: number;
  branch_id: string;
  name: string;
  model: string;
  ip_address: string;
  username: string;
  password?: string;
  is_active: boolean;
  last_polled_at: string | null;
  last_status: string | null;
}

export interface EmployeeWifiDevice {
  id: number;
  user_id: number;
  user_name?: string;
  mac_address: string;
  device_name: string | null;
  is_active: boolean;
  created_at: string;
  last_seen_at?: string | null;
  last_branch?: string | null;
}

export interface ConnectedClient {
  mac: string;
  ip?: string;
  name?: string;
  rssi?: number;
}

// Normalize MAC address to uppercase colon-separated format (XX:XX:XX:XX:XX:XX)
export function normalizeMac(mac: string): string | null {
  const clean = mac.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (clean.length !== 12) return null;
  return clean.match(/.{2}/g)!.join(':');
}

/**
 * Polls a router for its active connected client list (DHCP leases / ARP / Wireless clients).
 * Supports standard HTTP web portal interfaces found on common Egyptian store routers (TP-Link, ZTE, Huawei).
 */
export async function pollRouterConnectedClients(router: StoreRouter): Promise<ConnectedClient[]> {
  const clients: ConnectedClient[] = [];
  const targetIp = router.ip_address.trim();
  const username = router.username.trim();
  const password = router.password || '';

  if (!targetIp || !password) {
    throw new Error('بيانات الراوتر غير مكتملة (IP أو كلمة المرور فارغة)');
  }

  const baseUrl = `http://${targetIp}`;

  try {
    // 1. Try standard basic HTTP auth (common on TP-Link, Keenetic, OpenWrt)
    const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    // Try multiple common client-list endpoints
    const endpoints = [
      '/userRpm/AssignedIpAddrListRpm.htm',
      '/cgi/b/arp/',
      '/api/wlan/host-list',
      '/api/system/HostInfo',
      '/status.asp',
    ];

    let htmlOrJson = '';
    for (const ep of endpoints) {
      try {
        const res = await fetch(`${baseUrl}${ep}`, {
          headers: {
            'Authorization': authHeader,
            'User-Agent': 'Attendance-Router-Client/1.0',
          },
          signal: controller.signal,
        });

        if (res.ok) {
          htmlOrJson = await res.text();
          break;
        }
      } catch {
        continue;
      }
    }
    clearTimeout(timeout);

    if (htmlOrJson) {
      // Regex search for all MAC addresses in the response text
      const macMatches = htmlOrJson.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/g);
      if (macMatches) {
        const uniqueMacs = [...new Set(macMatches.map(m => normalizeMac(m)).filter(Boolean) as string[])];
        for (const m of uniqueMacs) {
          clients.push({ mac: m });
        }
      }
    }

    // Update router status in DB
    await query(
      `UPDATE store_routers 
       SET last_polled_at = NOW(), last_status = $1 
       WHERE id = $2`,
      [`متصل (${clients.length} جهاز)`, router.id]
    );

    return clients;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'فشل الاتصال بالراوتر';
    await query(
      `UPDATE store_routers 
       SET last_polled_at = NOW(), last_status = $1 
       WHERE id = $2`,
      [`خطأ: ${errorMsg}`, router.id]
    );
    throw new Error(`تعذر الاتصال بالراوتر على ${targetIp}: ${errorMsg}`);
  }
}

/**
 * Record presence sightings for connected MACs and match them to employees.
 */
export async function recordWifiSightings(branchId: string, macList: string[]): Promise<number> {
  let matched = 0;
  const now = new Date();

  for (const rawMac of macList) {
    const mac = normalizeMac(rawMac);
    if (!mac) continue;

    // Check if this MAC belongs to an employee
    const dev = (await query<{ user_id: number }>(
      `SELECT user_id FROM employee_wifi_devices WHERE mac_address = $1 AND is_active = TRUE`,
      [mac]
    )).rows[0];

    const userId = dev ? dev.user_id : null;

    await query(
      `INSERT INTO wifi_presence_sightings(branch_id, mac_address, user_id, recorded_at)
       VALUES($1, $2, $3, $4)`,
      [branchId, mac, userId, now]
    );

    if (userId) {
      matched++;
    }
  }

  return matched;
}
