import { NextRequest, NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth';
import { loadSettings } from '@/lib/schema';
import { loadBlePresence } from '@/lib/ble';

export async function GET(req: NextRequest) {
  try {
    const session = await getActiveSession(req);
    if (!session || session.role !== 'employee') return NextResponse.json({ error: 'حساب موظف مطلوب' }, { status: 401 });
    const requested = req.nextUrl.searchParams.get('userId') || req.nextUrl.searchParams.get('user_id');
    if (requested !== null && requested !== String(session.id)) return NextResponse.json({ error: 'لا يمكنك قراءة رصد موظف آخر' }, { status: 403 });
    const settings = await loadSettings();
    const presence = (await loadBlePresence([{ ...session, is_active: true }], settings)).get(session.id);
    return NextResponse.json(presence, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Employee BLE presence', error);
    return NextResponse.json({ error: 'تعذر تحميل رصد التاج؛ لا يُعتبر انقطاع الاتصال غيابًا' }, { status: 503 });
  }
}
