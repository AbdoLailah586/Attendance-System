'use client';

export type EventType = 'clock_in' | 'ping' | 'clock_out';
export interface PendingEvent {
  client_event_id: string; user_id: number; recorded_at: string; event_type: EventType;
  lat: number | null; lng: number | null; accuracy: number | null;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('attendance-offline', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('events', { keyPath: 'client_event_id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('تعذر الحفظ على الهاتف؛ لن نسجل حضورًا قبل ضمان حفظه'));
  });
}
async function mutate(action: (store: IDBObjectStore) => void) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('events', 'readwrite');
    action(tx.objectStore('events'));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('تعذر حفظ الحدث؛ مساحة الهاتف قد تكون ممتلئة')); };
  });
}
export async function pendingEvents(userId: number): Promise<PendingEvent[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('events', 'readonly');
    const request = tx.objectStore('events').getAll();
    request.onsuccess = () => resolve((request.result as PendingEvent[]).filter(e => e.user_id === userId).sort((a,b) => a.recorded_at.localeCompare(b.recorded_at)));
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
export async function saveEvent(event: Omit<PendingEvent, 'client_event_id'>): Promise<PendingEvent> {
  const saved = { ...event, client_event_id: crypto.randomUUID() };
  await mutate(store => store.add(saved));
  return saved;
}
const syncing = new Map<number, Promise<number>>();
export function syncEvents(userId: number): Promise<number> {
  const existing = syncing.get(userId);
  if (existing) return existing;
  const run = (async () => {
    let count = 0;
    for (;;) {
      const events = (await pendingEvents(userId)).slice(0, 100);
      if (!events.length) return count;
      // Never replay an old user's queue into a different authenticated account.
      const identity = await fetch('/api/auth/me', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!identity.ok || (await identity.json()).user?.id !== userId) throw new Error('سجل الدخول بنفس الحساب لمزامنة الأحداث المحفوظة');
      const response = await fetch('/api/attendance/ping', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }), signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'المزامنة مؤجلة');
      const acknowledged = new Set<string>(data.acknowledged?.map((a: { client_event_id: string }) => a.client_event_id));
      const accepted = events.filter(e => acknowledged.has(e.client_event_id));
      if (!accepted.length) throw new Error('لم يؤكد السيرفر استلام الأحداث');
      await mutate(store => accepted.forEach(e => store.delete(e.client_event_id)));
      count += accepted.length;
    }
  })().finally(() => syncing.delete(userId));
  syncing.set(userId, run);
  return run;
}
