import { NextRequest, NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth';
import { query } from '@/lib/db';
import {
  normalizeMac,
  pollRouterConnectedClients,
  recordWifiSightings,
  StoreRouter,
  EmployeeWifiDevice
} from '@/lib/wifi-presence';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest) {
  try {
    const session = await getActiveSession(req);
    if (session?.role !== 'admin') {
      return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
    }

    const routers = (await query<StoreRouter>(
      `SELECT id, branch_id, name, model, ip_address, username, is_active, 
              to_char(last_polled_at, 'YYYY-MM-DD HH24:MI:SS') AS last_polled_at, 
              last_status 
       FROM store_routers ORDER BY branch_id ASC`
    )).rows;

    const devices = (await query<EmployeeWifiDevice>(
      `SELECT d.id, d.user_id, u.name AS user_name, d.mac_address, d.device_name, d.is_active,
              to_char(d.created_at, 'YYYY-MM-DD') AS created_at,
              to_char(MAX(s.recorded_at), 'YYYY-MM-DD HH24:MI:SS') AS last_seen_at,
              (SELECT s2.branch_id FROM wifi_presence_sightings s2 
               WHERE s2.mac_address = d.mac_address ORDER BY s2.recorded_at DESC LIMIT 1) AS last_branch
       FROM employee_wifi_devices d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN wifi_presence_sightings s ON s.mac_address = d.mac_address
       GROUP BY d.id, d.user_id, u.name, d.mac_address, d.device_name, d.is_active, d.created_at
       ORDER BY d.id ASC`
    )).rows;

    const recentSightings = (await query<{
      id: string;
      branch_id: string;
      mac_address: string;
      user_name: string | null;
      recorded_at: string;
    }>(
      `SELECT s.id, s.branch_id, s.mac_address, u.name AS user_name,
              to_char(s.recorded_at, 'YYYY-MM-DD HH24:MI:SS') AS recorded_at
       FROM wifi_presence_sightings s
       LEFT JOIN users u ON u.id = s.user_id
       ORDER BY s.recorded_at DESC LIMIT 30`
    )).rows;

    return NextResponse.json({ routers, devices, recentSightings }, { headers });
  } catch (error) {
    console.error('Wi-Fi presence GET error:', error);
    return NextResponse.json({ error: 'تعذر تحميل بيانات شبكات الواي فاي' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getActiveSession(req);
    if (session?.role !== 'admin') {
      return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !body.action) {
      return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 });
    }

    if (body.action === 'save_router') {
      const { id, branch_id, name, model, ip_address, username, password } = body;
      if (!branch_id || !ip_address) {
        return NextResponse.json({ error: 'بيانات الراوتر غير مكتملة' }, { status: 400 });
      }

      if (id) {
        if (password) {
          await query(
            `UPDATE store_routers 
             SET branch_id = $1, name = $2, model = $3, ip_address = $4, username = $5, password = $6 
             WHERE id = $7`,
            [branch_id, name, model || 'generic', ip_address, username || 'admin', password, id]
          );
        } else {
          await query(
            `UPDATE store_routers 
             SET branch_id = $1, name = $2, model = $3, ip_address = $4, username = $5 
             WHERE id = $6`,
            [branch_id, name, model || 'generic', ip_address, username || 'admin', id]
          );
        }
      } else {
        await query(
          `INSERT INTO store_routers(branch_id, name, model, ip_address, username, password)
           VALUES($1, $2, $3, $4, $5, $6)`,
          [branch_id, name, model || 'generic', ip_address, username || 'admin', password || '']
        );
      }
      return NextResponse.json({ success: true, message: 'تم حفظ بيانات الراوتر بنجاح' }, { headers });
    }

    if (body.action === 'register_device') {
      const { user_id, mac_address, device_name } = body;
      const cleanMac = normalizeMac(mac_address);
      if (!cleanMac || !user_id) {
        return NextResponse.json({ error: 'عنوان MAC وموظف صالحان مطلوبان' }, { status: 400 });
      }

      await query(
        `INSERT INTO employee_wifi_devices(user_id, mac_address, device_name)
         VALUES($1, $2, $3)
         ON CONFLICT(mac_address) DO UPDATE SET user_id = $1, device_name = $3, is_active = TRUE`,
        [Number(user_id), cleanMac, device_name || null]
      );
      return NextResponse.json({ success: true, message: 'تم ربط ماك الهاتف بالموظف بنجاح' }, { headers });
    }

    if (body.action === 'remove_device') {
      const { id } = body;
      await query(`DELETE FROM employee_wifi_devices WHERE id = $1`, [id]);
      return NextResponse.json({ success: true, message: 'تم حذف الجهاز' }, { headers });
    }

    if (body.action === 'poll_router') {
      const { router_id } = body;
      const router = (await query<StoreRouter>(`SELECT * FROM store_routers WHERE id = $1`, [router_id])).rows[0];
      if (!router) {
        return NextResponse.json({ error: 'الراوتر غير موجود' }, { status: 404 });
      }

      const clients = await pollRouterConnectedClients(router);
      const matched = await recordWifiSightings(router.branch_id, clients.map(c => c.mac));

      return NextResponse.json({
        success: true,
        clientsCount: clients.length,
        matchedEmployees: matched,
        clients,
      }, { headers });
    }

    return NextResponse.json({ error: 'عملية غير معتمدة' }, { status: 400 });
  } catch (error) {
    console.error('Wi-Fi presence POST error:', error);
    const msg = error instanceof Error ? error.message : 'تعذر حفظ البيانات';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
