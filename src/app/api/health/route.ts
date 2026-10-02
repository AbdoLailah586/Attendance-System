import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
export async function GET() {
  try {
    await query('SELECT 1');
    return NextResponse.json({status:'ok',version:'attendance-mobile-v2',commit:process.env.VERCEL_GIT_COMMIT_SHA || null,timeZone:'Africa/Cairo'}, {headers:{'Cache-Control':'no-store'}});
  } catch {return NextResponse.json({status:'unavailable',version:'attendance-mobile-v2'}, {status:503});}
}
