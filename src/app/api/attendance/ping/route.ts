import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getActiveSession } from '@/lib/auth';
import { verifiedBranchLocation } from '@/lib/geo';
import { loadSettings } from '@/lib/schema';
import {scheduleWindows,inTrackingWindow} from '@/lib/tracking-window';
import type {AppUser} from '@/lib/types';
import type {EmployeePolicy} from '@/lib/period-report';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(['ping', 'clock_in', 'clock_out']);

export async function POST(req: NextRequest) {
  try {
    const session = await getActiveSession(req);
    if (!session || session.role !== 'employee') return NextResponse.json({ error: 'حساب موظف نشط مطلوب' }, { status: 401 });
    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({error:'بيانات غير صالحة'},{status:400});
    const events = Array.isArray(body.events) ? body.events : [body];
    if (!events.length || events.length > 100) return NextResponse.json({ error: 'أرسل من 1 إلى 100 حدث' }, { status: 400 });
    const now = Date.now();
    const normalized = [];
    for (const event of events) {
      if (!event || typeof event !== 'object') return NextResponse.json({ error: 'حدث غير صالح' }, { status: 400 });
      if (event.user_id !== undefined && event.user_id !== session.id) return NextResponse.json({error:'سجل الدخول بنفس الحساب لمزامنة الأحداث المحفوظة'},{status:409});
      const { lat, lng, accuracy, event_type = 'ping', client_event_id, recorded_at } = event;
      const noLocation = event_type === 'clock_out' && lat == null && lng == null;
      if (!TYPES.has(event_type) || (!noLocation && (
        typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90 ||
        typeof lng !== 'number' || !Number.isFinite(lng) || Math.abs(lng) > 180 ||
        typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000
      ))) return NextResponse.json({ error: 'نوع الحدث أو إحداثيات GPS غير صالحة' }, { status: 400 });
      if (client_event_id !== undefined && (typeof client_event_id !== 'string' || !UUID.test(client_event_id))) return NextResponse.json({ error: 'معرف الحدث غير صالح' }, { status: 400 });
      if (recorded_at !== undefined && (typeof recorded_at !== 'string' || !/T.*(Z|[+-]\d{2}:\d{2})$/.test(recorded_at))) return NextResponse.json({ error: 'وقت الحدث يجب أن يتضمن المنطقة الزمنية' }, { status: 400 });
      const time = recorded_at ? Date.parse(recorded_at) : now;
      if (!Number.isFinite(time) || time > now + 120000 || time < now - 31 * 86400000 || (recorded_at && !client_event_id)) return NextResponse.json({ error: 'اضبط ساعة الجهاز؛ المزامنة متاحة لآخر 31 يومًا' }, { status: 400 });
      normalized.push({ lat: noLocation ? null : lat, lng: noLocation ? null : lng, accuracy: noLocation ? null : accuracy, event_type, client_event_id: client_event_id || null, time });
    }
    const settings = await loadSettings();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const reset = (await client.query("SELECT attendance_reset_at FROM settings WHERE id='main' FOR SHARE")).rows[0]?.attendance_reset_at;
      const user=(await client.query<AppUser>("SELECT *,to_char(attendance_start_date,'YYYY-MM-DD') AS attendance_start_date FROM users WHERE id=$1",[session.id])).rows[0];
      const policies=(await client.query<EmployeePolicy>("SELECT *,to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM employee_policies WHERE user_id=$1",[session.id])).rows;
      const acknowledgements = [];
      let latest;
      let location;
      for (const event of normalized) {
        if (reset && event.time < new Date(reset).getTime()) {
          acknowledgements.push({client_event_id:event.client_event_id,duplicate:false,discarded:true,reason:'attendance_reset'});
          continue;
        }
        // Discard obsolete mobile controls so queued batches can continue syncing.
        if(settings.attendance_mode==='nfc'&&event.event_type!=='ping'){
          acknowledgements.push({client_event_id:event.client_event_id,discarded:true,reason:'nfc_required'});continue;
        }
        const windows=scheduleWindows(user,policies,new Date(event.time));
        const window=windows.find(w=>event.time>=w.start&&event.time<w.end);
        if(!inTrackingWindow(windows,event.time)){
          acknowledgements.push({client_event_id:event.client_event_id,discarded:true,reason:'outside_shift'});continue;
        }
        const out=window?(await client.query("SELECT timestamp FROM attendance_logs WHERE user_id=$1 AND source='nfc' AND shift_day=$2 AND event_type='clock_out'",[session.id,window.day])).rows[0]:null;
        if(out&&event.time>=+new Date(out.timestamp)){
          acknowledgements.push({client_event_id:event.client_event_id,discarded:true,reason:'after_nfc_checkout'});continue;
        }
        const geo = event.lat == null ? null : verifiedBranchLocation(event.lat, event.lng, event.accuracy, settings);
        const branch = geo?.branch_id || 'unknown';
        const result = await client.query(`INSERT INTO attendance_logs
          (user_id, timestamp, branch_id, lat, lng, accuracy, distance_branch1, distance_branch2, event_type, client_event_id, received_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
          ON CONFLICT (user_id, client_event_id) DO NOTHING RETURNING *`,
          [session.id, new Date(event.time).toISOString(), branch, event.lat, event.lng, event.accuracy, geo?.distance1 ?? null, geo?.distance2 ?? null, event.event_type, event.client_event_id]);
        acknowledgements.push({ client_event_id: event.client_event_id, duplicate: !result.rows.length });
        latest = result.rows[0] || latest;
        location = { ...geo, branch_id: branch, branch_name: branch === 'unknown' ? 'موقع غير مؤكد' : geo?.branch_name };
      }
      await client.query('COMMIT');
      return NextResponse.json({ success: true, acknowledged: acknowledgements, log: latest, location, attendance_reset_at:reset, settings: { branch1_name: settings.branch1_name, branch2_name: settings.branch2_name, ping_interval_secs: settings.ping_interval_secs } });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  } catch (error) {
    console.error('Attendance sync failed:', error);
    return NextResponse.json({ error: 'تعذر المزامنة؛ احتفظ بالأحداث وأعد المحاولة' }, { status: 503 });
  }
}
