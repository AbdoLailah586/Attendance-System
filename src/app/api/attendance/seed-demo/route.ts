import { NextResponse } from 'next/server';
export async function POST() {
  return NextResponse.json({error:'توليد البيانات التجريبية متوقف لحماية سجلات الحضور'}, {status:410});
}
