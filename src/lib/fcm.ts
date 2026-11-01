import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { query } from './db';

interface ServiceAccountConfig {
  project_id: string;
  client_email: string;
  private_key: string;
}

let cachedAuthClient: InstanceType<typeof google.auth.JWT> | null = null;
let cachedProjectId: string = '';

function loadServiceAccount(): ServiceAccountConfig {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return parsed;
      }
    } catch (e) {
      console.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT env:', e);
    }
  }

  // Fallback to local FIRE directory if available
  const fireDir = path.join(process.cwd(), 'FIRE');
  if (fs.existsSync(fireDir)) {
    const files = fs.readdirSync(fireDir);
    const saFile = files.find(f => f.includes('firebase-adminsdk') && f.endsWith('.json'));
    if (saFile) {
      const content = fs.readFileSync(path.join(fireDir, saFile), 'utf8');
      return JSON.parse(content);
    }
  }

  throw new Error('Firebase service account credentials not configured');
}

function getAuthClient(): { client: InstanceType<typeof google.auth.JWT>; projectId: string } {
  if (!cachedAuthClient) {
    const sa = loadServiceAccount();
    cachedProjectId = sa.project_id;
    cachedAuthClient = new google.auth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
  }
  return { client: cachedAuthClient, projectId: cachedProjectId };
}

export interface PushMessageData {
  title: string;
  body: string;
  kind?: string;
  day?: string;
  business_day?: string;
  user_id?: string | number;
  report_url?: string;
  filename?: string;
  key?: string;
  [key: string]: string | number | undefined;
}

export async function sendFCMMessage(deviceToken: string, data: PushMessageData): Promise<boolean> {
  const { client, projectId } = getAuthClient();
  const tokenResponse = await client.authorize();
  const accessToken = tokenResponse.access_token;

  if (!accessToken) throw new Error('Failed to obtain Google access token');

  // Convert all data fields to string as required by FCM
  const stringData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && v !== null) {
      stringData[k] = String(v);
    }
  }

  const payload = {
    message: {
      token: deviceToken,
      notification: {
        title: data.title,
        body: data.body,
      },
      data: stringData,
      android: {
        priority: 'HIGH' as const,
        notification: {
          channel_id: 'shift-reports',
          sound: 'default',
          default_vibrate_timings: true,
          notification_priority: 'PRIORITY_HIGH' as const,
          visibility: 'PRIVATE' as const,
        },
      },
    },
  };

  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (response.status === 200) {
    return true;
  }

  const errText = await response.text();
  console.warn(`FCM send failed (${response.status}):`, errText);

  // If unregistered or invalid token, clean it up from DB
  if (response.status === 404 || errText.includes('UNREGISTERED') || errText.includes('INVALID_ARGUMENT')) {
    try {
      await query('DELETE FROM admin_push_devices WHERE token = $1', [deviceToken]);
    } catch {}
  }

  return false;
}

export async function broadcastPushToAdmins(data: PushMessageData): Promise<{ sent: number; failed: number }> {
  try {
    const devices = await query<{ token: string; user_id: number }>(
      `SELECT d.token, d.user_id 
       FROM admin_push_devices d
       JOIN users u ON u.id = d.user_id
       WHERE u.role = 'admin' AND u.is_active = TRUE`
    );

    if (!devices.rows.length) {
      return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    await Promise.all(
      devices.rows.map(async row => {
        try {
          const ok = await sendFCMMessage(row.token, data);
          if (ok) sent++;
          else failed++;
        } catch (e) {
          console.error(`Error sending push to admin ${row.user_id}:`, e);
          failed++;
        }
      })
    );

    return { sent, failed };
  } catch (err) {
    console.error('broadcastPushToAdmins failed:', err);
    return { sent: 0, failed: 0 };
  }
}
