package com.joestore.attendance;
import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
public class AdminReportWorker extends Worker {
    public AdminReportWorker(@NonNull Context c,@NonNull WorkerParameters p){super(c,p);}
    @NonNull @Override public Result doWork(){
        if(!AdminReports.enabled(getApplicationContext()))return Result.success();
        int owner=TrackingStore.get(getApplicationContext()).userId();
        try{AdminReports.check(getApplicationContext());return Result.success();}
        catch(SecurityException e){if(owner==TrackingStore.get(getApplicationContext()).userId()){AdminReports.clear(getApplicationContext());AdminReports.prefs(getApplicationContext()).edit().putString("error","راجع صلاحية الإشعارات وسجل الدخول بحساب المدير لتجديد التنبيهات").apply();}return Result.success();}
        catch(Exception e){if(owner!=TrackingStore.get(getApplicationContext()).userId())return Result.success();AdminReports.prefs(getApplicationContext()).edit().putString("error","تعذر جلب التقرير؛ سنحاول عند توفر الإنترنت").apply();return Result.retry();}
    }
}
