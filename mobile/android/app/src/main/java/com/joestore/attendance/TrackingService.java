package com.joestore.attendance;

import android.Manifest;
import android.app.*;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;
import androidx.core.app.NotificationCompat;

public class TrackingService extends Service implements LocationListener {
    private LocationManager locations;
    private TrackingStore store;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private long lastRecorded=0;
    private final Runnable sync=new Runnable(){ public void run(){store.sync();handler.postDelayed(this,30000);} };
    @Override public void onCreate() {
        super.onCreate(); store=TrackingStore.get(this);
        NotificationManager notifications=getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel("attendance", "تتبع الحضور أثناء الشيفت",NotificationManager.IMPORTANCE_LOW));
        Intent launch=new Intent(this,MainActivity.class);
        PendingIntent open=PendingIntent.getActivity(this,0,launch,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification=new NotificationCompat.Builder(this,"attendance").setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("شيفت حضور جو ستور شغّال").setContentText("الموقع محفوظ على الهاتف ويُزامن عند توفر الإنترنت").setContentIntent(open).setOngoing(true).build();
        startForeground(71,notification);
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        if(!store.active()){stopSelf();return START_NOT_STICKY;}
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){store.error("اسمح بالموقع الدقيق لاستكمال التتبع");stopSelf();return START_NOT_STICKY;}
        if(locations==null){
            locations=(LocationManager)getSystemService(LOCATION_SERVICE);
            for(String provider:new String[]{LocationManager.GPS_PROVIDER,LocationManager.NETWORK_PROVIDER}) {
                try {if(locations.isProviderEnabled(provider)) locations.requestLocationUpdates(provider,60000,0,this,Looper.getMainLooper());} catch(Exception e){store.error("تعذر تشغيل GPS");}
            }
            handler.post(sync);
        }
        return START_STICKY;
    }
    @Override public void onLocationChanged(Location location) {
        if((Build.VERSION.SDK_INT>=31?location.isMock():location.isFromMockProvider())||!location.hasAccuracy()||System.currentTimeMillis()-location.getTime()>90000)return;
        if(System.currentTimeMillis()-lastRecorded<50000)return;
        try{store.recordPing(location);lastRecorded=System.currentTimeMillis();store.sync();}catch(Exception e){store.error("تعذر الحفظ على الهاتف؛ راجع مساحة التخزين");}
    }
    @Override public void onProviderDisabled(String provider){store.error("GPS متوقف؛ افتح إعدادات الموقع");}
    @Override public void onDestroy(){handler.removeCallbacksAndMessages(null);if(locations!=null)locations.removeUpdates(this);super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
