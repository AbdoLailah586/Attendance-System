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
    private boolean listening=false;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private long lastRecorded=0,lastSync=0;
    private final Runnable tick=new Runnable(){public void run(){
        if(!store.active()){stopSelf();return;}
        boolean allowed=store.allowed();
        if(allowed&&!listening)listen();else if(!allowed&&listening)pause();
        if(System.currentTimeMillis()-lastSync>=30000){store.refreshSchedule();store.sync();lastSync=System.currentTimeMillis();}
        long end=store.windowEnd();handler.postDelayed(this,end>0?Math.max(1,Math.min(1000,end-System.currentTimeMillis())):1000);
    }};
    @Override public void onCreate(){
        super.onCreate();store=TrackingStore.get(this);locations=(LocationManager)getSystemService(LOCATION_SERVICE);
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("attendance","متابعة الموقع داخل الشيفت فقط",NotificationManager.IMPORTANCE_LOW));
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        startForeground(71,new NotificationCompat.Builder(this,"attendance").setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("متابعة الشيفت مفعّلة").setContentText("GPS يعمل في مواعيد الشيفت فقط؛ الحضور والانصراف بالكارت").setContentIntent(open).setOngoing(true).build());
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){handler.removeCallbacks(tick);handler.post(tick);return START_STICKY;}
    private void listen(){
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){store.error("اسمح بالموقع الدقيق");return;}
        for(String provider:new String[]{LocationManager.GPS_PROVIDER,LocationManager.NETWORK_PROVIDER}){
            try{if(locations.isProviderEnabled(provider)){locations.requestLocationUpdates(provider,60000,0,this,Looper.getMainLooper());listening=true;}}catch(Exception e){store.error("تعذر تشغيل GPS");}
        }
    }
    private void pause(){locations.removeUpdates(this);listening=false;}
    @Override public void onLocationChanged(Location location){
        if(!store.active()||!store.allowed()){pause();return;}
        if((Build.VERSION.SDK_INT>=31?location.isMock():location.isFromMockProvider())||!location.hasAccuracy()||System.currentTimeMillis()-location.getTime()>90000)return;
        if(System.currentTimeMillis()-lastRecorded<50000)return;
        try{store.recordPing(location);lastRecorded=System.currentTimeMillis();store.sync();}catch(Exception e){store.error("تعذر حفظ الموقع على الهاتف");}
    }
    @Override public void onProviderDisabled(String provider){store.error("GPS متوقف؛ توجد فجوة تتبع");}
    @Override public void onDestroy(){handler.removeCallbacksAndMessages(null);if(locations!=null)pause();super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
