import { NextRequest, NextResponse } from "next/server";
// @ts-ignore
const backupManager = require("@/lib/backupManager");

export const maxDuration = 60; // Allow maximum runtime on Vercel
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      // If CRON_SECRET is configured, enforce authorization
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await backupManager.runBackup();
    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error("Cron backup error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}

