import { NextRequest, NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth';
import { getPool, query } from '@/lib/db';
import { addDays } from '@/lib/period-report';
import { cairoTime, localDate, validDay } from '@/lib/time';
import { BLE_STALE_SECONDS, bleAddress, combinedObservationReport, ensureBleSchema, observationAt, observationReport, receiverState,
  type BleEvent, type BleHeartbeat, type BleTag } from '@/lib/ble';

const headers = { 'Cache-Control': 'private, no-store' };
interface DeviceRow { id: string; name: string; branch_id: string; branch_name: string; is_active: boolean; configured_at:string|Date|null }
export async function GET(req: NextRequest) {
  try {
    if ((await getActiveSession(req))?.role !== 'admin') return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
    const params = req.nextUrl.searchParams, fromDay = params.get('from_day') || localDate(), toDay = params.get('to_day') || fromDay;
    const page = Number(params.get('page') || 1), userId = params.get('user_id');
    if (!validDay(fromDay) || !validDay(toDay) || toDay < fromDay || Date.parse(toDay) - Date.parse(fromDay) > 31 * 86400000
      || !Number.isInteger(page) || page < 1 || page > 100000 || (userId !== null && !/^[1-9]\d*$/.test(userId)))
      return NextResponse.json({ error: 'اختار فترة صحيحة لا تتجاوز 32 يومًا وصفحة صحيحة' }, { status: 400 });
    await ensureBleSchema();
    const now = Date.now(), from = +cairoTime(fromDay), to = Math.min(now, +cairoTime(addDays(toDay, 1)));
    const tagFilter = userId ? 'WHERE t.user_id=$1' : '', userFilter = userId ? 'WHERE id=$1' : "WHERE role='employee' OR EXISTS(SELECT 1 FROM ble_tags t WHERE t.user_id=users.id)";
    const [tagRows, devicesRows, liveHeartbeats, liveEvents, logs, count, heartbeats, events, users, windowRows, unknownTags] = await Promise.all([
      query<BleTag>(`SELECT t.*,u.name,u.username FROM ble_tags t JOIN users u ON u.id=t.user_id ${tagFilter} ORDER BY t.assigned_at,t.id`, userId ? [Number(userId)] : []),
      query<DeviceRow>(`SELECT d.id,d.name,d.branch_id,(d.is_active AND b.is_active) AS is_active,b.name AS branch_name,
        (SELECT MIN(h.recorded_at) FROM ble_receiver_heartbeats h WHERE h.device_id=d.id AND h.recorded_at<=NOW()) AS configured_at
        FROM nfc_devices d JOIN branches b ON b.id=d.branch_id ORDER BY d.created_at`),
      query<BleHeartbeat>(`SELECT DISTINCT ON(device_id) * FROM ble_receiver_heartbeats WHERE recorded_at<=NOW() ORDER BY device_id,recorded_at DESC,id DESC`),
      query<BleEvent>(`SELECT DISTINCT ON(device_id,tag_address) * FROM ble_events WHERE recorded_at<=NOW() ORDER BY device_id,tag_address,recorded_at DESC,id DESC`),
      query(`SELECT e.*,u.name AS user_name,d.name AS device_name,b.name AS branch_name FROM ble_events e
        LEFT JOIN users u ON u.id=e.user_id JOIN nfc_devices d ON d.id=e.device_id LEFT JOIN branches b ON b.id=e.branch_id
        WHERE recorded_at>=$1 AND recorded_at<$2 ${userId ? 'AND e.user_id=$4' : ''} ORDER BY e.received_at DESC,e.id DESC LIMIT 100 OFFSET $3`,
      userId ? [new Date(from), new Date(Math.max(from, to)), (page - 1) * 100, Number(userId)] : [new Date(from), new Date(Math.max(from, to)), (page - 1) * 100]),
      query(`SELECT count(*)::int AS total FROM ble_events WHERE recorded_at>=$1 AND recorded_at<$2 ${userId ? 'AND user_id=$3' : ''}`,
      userId ? [new Date(from), new Date(Math.max(from, to)), Number(userId)] : [new Date(from), new Date(Math.max(from, to))]),
      query<BleHeartbeat>('SELECT * FROM ble_receiver_heartbeats WHERE recorded_at>=$1 AND recorded_at<$2 ORDER BY recorded_at,id LIMIT 200001', [new Date(from - 600000), new Date(Math.max(from, to))]),
      query<BleEvent>(`WITH prior AS (SELECT DISTINCT ON(device_id,tag_address) * FROM ble_events WHERE recorded_at<$1
          ORDER BY device_id,tag_address,recorded_at DESC,id DESC), recent AS (SELECT * FROM ble_events
          WHERE recorded_at>=$1 AND recorded_at<$2 ORDER BY recorded_at,id LIMIT 200001)
        SELECT * FROM prior UNION ALL SELECT * FROM recent ORDER BY recorded_at,id LIMIT 200001`, [new Date(from - 600000), new Date(Math.max(from, to))]),
      query(`SELECT id,name,username,is_active,role FROM users ${userFilter} ORDER BY id`, userId ? [Number(userId)] : []),
      query(`SELECT i.user_id,i.timestamp AS start,LEAST(
          COALESCE(o.timestamp,'infinity'::timestamptz),
          COALESCE(i.tracking_deadline,i.timestamp+(COALESCE(u.max_tracking_hours,s.max_tracking_hours,12)::int*INTERVAL '1 hour')),
          COALESCE((SELECT MIN(n.timestamp) FROM attendance_logs n WHERE n.user_id=i.user_id AND n.source='nfc' AND n.event_type='clock_in' AND n.timestamp>i.timestamp),'infinity'::timestamptz)
        ) AS finish FROM attendance_logs i JOIN users u ON u.id=i.user_id CROSS JOIN settings s
        LEFT JOIN attendance_logs o ON o.user_id=i.user_id AND o.shift_day=i.shift_day AND o.source='nfc' AND o.event_type='clock_out'
        WHERE s.id='main' AND i.source='nfc' AND i.event_type='clock_in' AND i.timestamp>=$1 AND i.timestamp<$2 ${userId ? 'AND i.user_id=$3' : ''}`,
      userId ? [new Date(Math.min(from, now) - 36 * 3600000), new Date(Math.max(to, now + 1)), Number(userId)] : [new Date(Math.min(from, now) - 36 * 3600000), new Date(Math.max(to, now + 1))]),
      query(`SELECT DISTINCT ON(e.tag_address) e.tag_address,e.state,e.recorded_at,d.name AS device_name,b.name AS branch_name
        FROM ble_events e JOIN nfc_devices d ON d.id=e.device_id LEFT JOIN branches b ON b.id=e.branch_id
        WHERE NOT EXISTS(SELECT 1 FROM ble_tags t WHERE t.address=e.tag_address AND t.revoked_at IS NULL)
        ORDER BY e.tag_address,e.recorded_at DESC,e.id DESC LIMIT 100`),
    ]);
    const windows = windowRows.rows.map(w => ({ user_id: w.user_id as number, start: +new Date(w.start), end: +new Date(w.finish) }));
    const devices = devicesRows.rows.map(d => {
      const heartbeat = liveHeartbeats.rows.find(h => h.device_id === d.id);
      return { ...d, receiver_state: d.is_active ? receiverState(heartbeat, now) : 'disabled', last_heartbeat: heartbeat?.recorded_at || null };
    });
    const tags = tagRows.rows.filter(t => !t.revoked_at).map(tag => ({ ...tag, observations: devices.map(device => {
      const event = liveEvents.rows.find(e => e.device_id === device.id && e.tag_address === tag.address);
      const heartbeat = liveHeartbeats.rows.find(h => h.device_id === device.id);
      const profile = users.rows.find(u => u.id === tag.user_id);
      const inSession = !!profile?.is_active && profile.role === 'employee' && windows.some(w => w.user_id === tag.user_id && w.start <= now && w.end > now);
      return { device_id: device.id, branch_id: device.branch_id, branch_name: device.branch_name, in_card_session: inSession,
        state: device.receiver_state === 'ready' ? observationAt(event, heartbeat, tag, now) : 'unknown',
        last_observation: event?.recorded_at || null, rssi: event?.rssi ?? null };
    }) }));
    const truncated = heartbeats.rows.length > 200000 || events.rows.length > 200000;
    const reports = users.rows.filter(u => tagRows.rows.some(t => t.user_id === u.id)).flatMap(user => devices.map(device => ({
      user_id: user.id, user_name: user.name, device_id: device.id, device_name: device.name, branch_id: device.branch_id, branch_name: device.branch_name,
      ...observationReport(tagRows.rows, truncated ? [] : events.rows, truncated ? [] : heartbeats.rows,
        windows.filter(w => w.user_id === user.id), device.id, user.id, from, to),
    }))).filter(r => r.session_seconds > 0);
    const combinedReports=users.rows.filter(u=>tagRows.rows.some(t=>t.user_id===u.id)).map(user=>({user_id:user.id,user_name:user.name,
      ...combinedObservationReport(tagRows.rows,truncated?[]:events.rows,truncated?[]:heartbeats.rows,windows.filter(w=>w.user_id===user.id),devicesRows.rows,user.id,from,to)
    })).filter(report=>report.session_seconds>0);
    return NextResponse.json({ tags, devices, logs: logs.rows, total: count.rows[0].total, page, unknown_tags: unknownTags.rows, reports,combined_reports:combinedReports,
      from_day: fromDay, to_day: toDay, receiver_stale_seconds: BLE_STALE_SECONDS, experimental: true, max_concurrent_tags: 3,
      truncated, server_time: new Date(now).toISOString(),
      meaning: 'رصد التاج أثناء فترة الكارت، وليس إثبات وجود الشخص أو غيابه. الفترات غير المرصودة للمراجعة ولا تخصم تلقائيًا.' }, { headers });
  } catch (error) { console.error('BLE admin read', error); return NextResponse.json({ error: 'تعذر تحميل رصد البلوتوث' }, { status: 503 }); }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await getActiveSession(req);
    if (admin?.role !== 'admin') return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
    const body = await req.json().catch(() => null);
    if (!body || !['assign_tag', 'revoke_tag', 'set_grace'].includes(body.action)) return NextResponse.json({ error: 'عملية غير صالحة' }, { status: 400 });
    await ensureBleSchema();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('attendance-ble-write'))");
      if (body.action === 'assign_tag') {
        const address = bleAddress(body.address), grace = body.grace_seconds ?? 90;
        if (!address || !Number.isInteger(body.user_id) || !Number.isInteger(grace) || grace < 60 || grace > 600
          || !(await client.query("SELECT id FROM users WHERE id=$1 AND is_active=TRUE AND role='employee'", [body.user_id])).rows.length) {
          await client.query('ROLLBACK'); return NextResponse.json({ error: 'عنوان التاج وموظف نشط ومهلة 60–600 ثانية مطلوبون' }, { status: 400 });
        }
        if ((await client.query('SELECT id FROM ble_tags WHERE address=$1 AND revoked_at IS NULL', [address])).rows.length) {
          await client.query('ROLLBACK'); return NextResponse.json({ error: 'التاج مرتبط بالفعل؛ ألغِ الربط قبل نقله' }, { status: 409 });
        }
        const result = await client.query('INSERT INTO ble_tags(address,user_id,grace_seconds,assigned_by) VALUES($1,$2,$3,$4) RETURNING *', [address, body.user_id, grace, admin.id]);
        await client.query('COMMIT'); return NextResponse.json({ success: true, tag: result.rows[0] }, { headers });
      }
      if (!Number.isInteger(body.id) || body.id < 1 || (body.action === 'set_grace' && (!Number.isInteger(body.grace_seconds) || body.grace_seconds < 60 || body.grace_seconds > 600))) {
        await client.query('ROLLBACK'); return NextResponse.json({ error: 'تاج صالح ومهلة 60–600 ثانية مطلوبان' }, { status: 400 });
      }
      const result = await client.query(body.action === 'revoke_tag'
        ? 'UPDATE ble_tags SET revoked_at=NOW(),revoked_by=$2 WHERE id=$1 AND revoked_at IS NULL RETURNING id'
        : 'UPDATE ble_tags SET grace_seconds=$2 WHERE id=$1 AND revoked_at IS NULL RETURNING id', [body.id, body.action === 'revoke_tag' ? admin.id : body.grace_seconds]);
      if (!result.rows.length) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'التاج غير موجود' }, { status: 404 }); }
      await client.query('COMMIT'); return NextResponse.json({ success: true }, { headers });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'التاج مرتبط بالفعل' }, { status: 409 });
    console.error('BLE admin update', error); return NextResponse.json({ error: 'تعذر حفظ إعداد البلوتوث' }, { status: 503 });
  }
}
