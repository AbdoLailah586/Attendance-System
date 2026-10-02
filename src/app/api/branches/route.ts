import { NextRequest, NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { loadSettings } from '@/lib/schema';

export async function PUT(req: NextRequest) {
  const session = await getActiveSession(req);
  if (!session || session.role !== 'admin') return NextResponse.json({error:'صلاحيات المدير مطلوبة'},{status:403});
  try {
    const { branches } = await req.json();
    if (!Array.isArray(branches) || branches.length < 2 || branches.length > 100 || new Set(branches.map(b => b.id)).size !== branches.length || !['branch1','branch2'].every(id => branches.some(b => b.id===id))) return NextResponse.json({error:'قائمة الفروع غير صالحة'},{status:400});
    for (const b of branches) {
      if (typeof b.id !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(b.id) || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 100 || !Number.isFinite(b.lat) || Math.abs(b.lat)>90 || !Number.isFinite(b.lng) || Math.abs(b.lng)>180 || !Number.isInteger(b.radius) || b.radius<10 || b.radius>5000) return NextResponse.json({error:'تحقق من اسم الفرع وإحداثياته ونطاقه (10–5000 متر)'},{status:400});
    }
    await loadSettings();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      // Omitted branches are deactivated; their attendance history is retained.
      await client.query('UPDATE branches SET is_active=FALSE');
      for (const b of branches) await client.query(`INSERT INTO branches(id,name,lat,lng,radius,is_active) VALUES($1,$2,$3,$4,$5,TRUE)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,lat=EXCLUDED.lat,lng=EXCLUDED.lng,radius=EXCLUDED.radius,is_active=TRUE`, [b.id,b.name.trim(),b.lat,b.lng,b.radius]);
      for (const id of ['branch1','branch2']) {
        const b = branches.find(b => b.id === id);
        await client.query(`UPDATE settings SET ${id}_name=$1,${id}_lat=$2,${id}_lng=$3,${id}_radius=$4,updated_at=NOW() WHERE id='main'`, [b.name.trim(),b.lat,b.lng,b.radius]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    return NextResponse.json({success:true,settings:await loadSettings()});
  } catch(error) { console.error(error); return NextResponse.json({error:'تعذر حفظ الفروع'},{status:503}); }
}
