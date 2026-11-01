import { NextRequest, NextResponse } from 'next/server';
import { dispatchReadyShiftAlerts } from '@/lib/push-dispatcher';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // Allow internal Vercel cron calls or proceed
    }

    const result = await dispatchReadyShiftAlerts();
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error('Cron shift-alerts error:', error);
    return NextResponse.json({ error: 'Failed to dispatch alerts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
