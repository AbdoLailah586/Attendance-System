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
    static volatile boolean collecting=false;
    private boolean foregroundReady=false;
    private String notificationState="";
    private final Handler handler=new Handler(Looper.getMainLooper());
    private long lastRecorded=0,lastSync=0;
    private final Runnable tick=new Runnable(){public void run(){
        if(!store.active()){stopSelf();return;}
        boolean allowed=store.allowed();
        if(listening&&checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){pause();store.error("صلاحية الموقع الدقيق متوقفة");}
        if(allowed&&!listening)listen();else if(!allowed&&listening)pause();
        String next=allowed?(listening?"الموقع يُجمع داخل فترة حضور الكارت":"جلسة حضور مفتوحة؛ راجع صلاحية الموقع وتشغيل GPS"):"GPS متوقف؛ ننتظر حضور الكارت أو يوم العمل التالي";
        if(!next.equals(notificationState)){notificationState=next;notifyState(next);}
        if(System.currentTimeMillis()-lastSync>=15000){store.refreshSchedule();store.sync();lastSync=System.currentTimeMillis();}
        long end=store.windowEnd();handler.postDelayed(this,end>0?Math.max(1,Math.min(1000,end-System.currentTimeMillis())):1000);
    }};
    @Override public void onCreate(){
        super.onCreate();store=TrackingStore.get(this);locations=(LocationManager)getSystemService(LOCATION_SERVICE);
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("attendance","متابعة الموقع بعد حضور الكارت",NotificationManager.IMPORTANCE_LOW));
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        try{startForeground(71,new NotificationCompat.Builder(this,"attendance").setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("متابعة حضور الكارت جاهزة").setContentText("GPS متوقف حتى حضور الكارت").setContentIntent(open).setOngoing(true).build());foregroundReady=true;}
        catch(SecurityException error){store.error("افتح التطبيق لاستكمال متابعة الموقع");stopSelf();}
    }
    private void notifyState(String text){
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){notificationState="";return;}
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        getSystemService(NotificationManager.class).notify(71,new NotificationCompat.Builder(this,"attendance").setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("متابعة حضور الكارت").setContentText(text).setContentIntent(open).setOngoing(true).build());
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){if(!foregroundReady)return START_NOT_STICKY;handler.removeCallbacks(tick);handler.post(tick);return START_STICKY;}
    private void listen(){
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){store.error("اسمح بالموقع الدقيق");return;}
        for(String provider:new String[]{LocationManager.GPS_PROVIDER,LocationManager.NETWORK_PROVIDER}){
            try{if(locations.isProviderEnabled(provider)){locations.requestLocationUpdates(provider,Math.max(15,store.prefs.getInt("ping_secs",60))*1000L,0,this,Looper.getMainLooper());listening=true;collecting=true;}}catch(Exception e){store.error("تعذر تشغيل GPS");}
        }
    }
    private void pause(){locations.removeUpdates(this);listening=false;collecting=false;}
    @Override public void onLocationChanged(Location location){
        if(!store.active()||!store.allowed()){pause();return;}
        if((Build.VERSION.SDK_INT>=31?location.isMock():location.isFromMockProvider())||!location.hasAccuracy()||!Float.isFinite(location.getAccuracy())||location.getAccuracy()<0||System.currentTimeMillis()-location.getTime()>90000||!store.allowedAt(location.getTime()))return;
        if(System.currentTimeMillis()-lastRecorded<Math.max(15,store.prefs.getInt("ping_secs",60))*1000L)return;
        try{store.recordPing(location);lastRecorded=System.currentTimeMillis();store.sync();}catch(Exception e){store.error("تعذر حفظ الموقع على الهاتف");}
    }
    @Override public void onProviderDisabled(String provider){pause();store.error("GPS متوقف؛ توجد فجوة تتبع");}
    @Override public void onProviderEnabled(String provider){}
    @Override public void onStatusChanged(String provider,int status,Bundle extras){}
    @Override public void onDestroy(){handler.removeCallbacksAndMessages(null);if(locations!=null)pause();super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
