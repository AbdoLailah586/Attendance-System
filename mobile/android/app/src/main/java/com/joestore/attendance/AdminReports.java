package com.joestore.attendance;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HttpsURLConnection;
import org.json.*;

final class AdminReports {
    private static final String TAG="admin-shift-reports", CHANNEL="shift-reports";
    static SharedPreferences prefs(Context c){return c.getSharedPreferences("admin-reports",Context.MODE_PRIVATE);}
    static boolean admin(TrackingStore s){try{return "admin".equals(new JSONObject(s.prefs.getString("user","{}")).optString("role"));}catch(Exception e){return false;}}
    static boolean enabled(Context c){TrackingStore s=TrackingStore.get(c);return admin(s)&&prefs(c).getBoolean("enabled",false)&&prefs(c).getInt("owner",0)==s.userId();}
    static void channel(Context c){c.getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL,"تقارير نهاية شيفت الموظفين",NotificationManager.IMPORTANCE_DEFAULT));}
    static boolean permitted(Context c){channel(c);NotificationChannel channel=c.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL);return NotificationManagerCompat.from(c).areNotificationsEnabled()&&channel.getImportance()!=NotificationManager.IMPORTANCE_NONE;}
    static void clear(Context c){prefs(c).edit().clear().apply();WorkManager.getInstance(c).cancelAllWorkByTag(TAG);for(android.service.notification.StatusBarNotification n:c.getSystemService(NotificationManager.class).getActiveNotifications())if(CHANNEL.equals(n.getNotification().getChannelId()))NotificationManagerCompat.from(c).cancel(n.getTag(),n.getId());}
    static void enable(Context c){
        TrackingStore s=TrackingStore.get(c);SharedPreferences p=prefs(c);
        if(!enabled(c))p.edit().putInt("owner",s.userId()).putLong("enabled_at",System.currentTimeMillis()).putStringSet("delivered",new HashSet<>()).apply();
        p.edit().putBoolean("enabled",true).remove("error").apply();
        Constraints network=new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(TAG,ExistingPeriodicWorkPolicy.KEEP,new PeriodicWorkRequest.Builder(AdminReportWorker.class,15,TimeUnit.MINUTES).setConstraints(network).addTag(TAG).build());
        refresh(c);
    }
    static void refresh(Context c){if(enabled(c))WorkManager.getInstance(c).enqueueUniqueWork(TAG+"-refresh",ExistingWorkPolicy.KEEP,new OneTimeWorkRequest.Builder(AdminReportWorker.class).setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).addTag(TAG).build());}
    static JSONObject get(String path,String token) throws Exception{
        if(!path.startsWith("/api/attendance/day-close")&&!path.startsWith("/api/admin/shift-alerts"))throw new IOException("Unsupported report path");
        HttpsURLConnection connection=(HttpsURLConnection)new URL(TrackingStore.API+path).openConnection();
        try{
            connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(30000);connection.setRequestProperty("Authorization","Bearer "+token);
            int code=connection.getResponseCode();if(code==401||code==403)throw new SecurityException("جلسة المدير تحتاج تجديدًا");if(code!=200)throw new IOException("Report HTTP "+code);
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
                byte[] buffer=new byte[4096];int n;while((n=input.read(buffer))!=-1){if(bytes.size()+n>4*1024*1024)throw new IOException("Report too large");bytes.write(buffer,0,n);}return new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
            }
        }finally{connection.disconnect();}
    }
    private static String duration(int seconds){return (seconds/3600)+" س "+(seconds%3600/60)+" د";}
    static void notify(Context c,int id,String title,String body,String day,int employee,int owner){
        if(Build.VERSION.SDK_INT>=33&&androidx.core.content.ContextCompat.checkSelfPermission(c,android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)throw new SecurityException("Notifications permission required");
        channel(c);Intent target=new Intent(c,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        target.putExtra("report_day",day).putExtra("report_employee",employee).putExtra("report_owner",owner);
        PendingIntent action=PendingIntent.getActivity(c,id,target,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        NotificationManagerCompat.from(c).notify(id,new NotificationCompat.Builder(c,CHANNEL).setSmallIcon(R.drawable.ic_stat_admin_report)
            .setContentTitle(title).setContentText(body).setStyle(new NotificationCompat.BigTextStyle().bigText(body)).setContentIntent(action).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build());
    }
    static void check(Context c) throws Exception{
        if(!enabled(c)||!permitted(c))return;
        TrackingStore store=TrackingStore.get(c);int owner=store.userId();String token=store.token();SharedPreferences p=prefs(c);
        long start=p.getLong("enabled_at",System.currentTimeMillis())-60000;
        JSONObject feed=get("/api/admin/shift-alerts?since="+URLEncoder.encode(Instant.ofEpochMilli(start).toString(),"UTF-8"),token);
        Map<String,JSONObject> reports=new HashMap<>();JSONArray jobs=feed.getJSONArray("jobs");
        for(int i=0;i<jobs.length();i++){
            JSONObject job=jobs.getJSONObject(i);if(!job.getBoolean("ready"))continue;String key=job.getString("key"),day=job.getString("business_day");
            if(p.getStringSet("delivered",Collections.emptySet()).contains(key))continue;
            JSONObject report=reports.get(day);if(report==null){report=get("/api/attendance/day-close?date="+day,token);reports.put(day,report);}
            JSONArray rows=report.getJSONArray("reports");JSONObject row=null;for(int j=0;j<rows.length();j++){JSONObject candidate=rows.getJSONObject(j);if(candidate.getJSONObject("user").getInt("id")==job.getInt("user_id")){row=candidate;break;}}
            if(row==null)continue;JSONObject summary=row.optJSONObject("ble_summary");String body=summary==null?"افتح التقرير لعرض أوقات الكارت والرصد":
                "مرصود "+duration(summary.optInt("observed_seconds"))+" · غير مرصود "+duration(summary.optInt("not_seen_seconds"))+" · غير معلوم "+duration(summary.optInt("unknown_seconds"));
            if(row.isNull("lastDeparture"))body+=" · لم يسجل انصرافًا بالكارت";
            synchronized(AdminReports.class){
                if(!enabled(c)||owner!=store.userId()||!token.equals(store.token()))return;
                Set<String> delivered=new HashSet<>(p.getStringSet("delivered",Collections.emptySet()));if(delivered.contains(key))continue;
                notify(c,key.hashCode(),"تقرير شيفت "+job.getString("name"),body,day,job.getInt("user_id"),owner);delivered.add(key);
                if(delivered.size()>500)delivered.removeIf(k->k.substring(k.indexOf(':')+1).compareTo(day)<0);
                p.edit().putStringSet("delivered",delivered).putString("last_report",report.toString()).putString("last_report_day",day).apply();
            }
        }
        if(!enabled(c)||owner!=store.userId()||!token.equals(store.token()))return;
        p.edit().putLong("last_sync",System.currentTimeMillis()).putString("next_due",feed.isNull("next_due_at")?"":feed.getString("next_due_at")).remove("error").apply();
        if(!feed.isNull("next_due_at")){
            long due=Instant.parse(feed.getString("next_due_at")).toEpochMilli(),server=Instant.parse(feed.getString("server_time")).toEpochMilli();
            WorkManager.getInstance(c).enqueueUniqueWork(TAG+"-due-"+due,ExistingWorkPolicy.KEEP,new OneTimeWorkRequest.Builder(AdminReportWorker.class)
                .setInitialDelay(Math.max(1000,due-server),TimeUnit.MILLISECONDS).setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).addTag(TAG).build());
        }
    }
}
