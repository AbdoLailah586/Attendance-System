package com.joestore.attendance;
// The administrator build has no location service or location permissions.
public final class TrackingService extends android.app.Service {
    static boolean collecting=false;
    @Override public android.os.IBinder onBind(android.content.Intent intent){return null;}
    @Override public int onStartCommand(android.content.Intent intent,int flags,int startId){stopSelf();return START_NOT_STICKY;}
}
