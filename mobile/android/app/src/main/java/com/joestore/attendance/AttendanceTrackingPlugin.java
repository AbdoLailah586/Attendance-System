package com.joestore.attendance;

import android.Manifest;
import android.content.Intent;
import android.location.*;
import android.os.*;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import org.json.JSONObject;

@CapacitorPlugin(name="AttendanceTracking",permissions={
    @Permission(alias="location",strings={Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION}),
    @Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})
})
public class AttendanceTrackingPlugin extends Plugin {
    private TrackingStore store;
    private boolean starting=false;
    @Override public void load(){store=TrackingStore.get(getContext());}
    @Override protected void handleOnResume(){
        if(store.active()&&getPermissionState("location")==PermissionState.GRANTED){
            try{getContext().startForegroundService(new Intent(getContext(),TrackingService.class));}catch(Exception e){store.error("افتح التطبيق واضغط مزامنة لاستكمال التتبع");}
        }
        store.sync();
    }
    @PluginMethod public void configure(PluginCall call){
        try{store.configure(call.getString("token",""),call.getString("user","{}"));call.resolve();}catch(Exception e){call.reject(e.getMessage());}
    }
    @PluginMethod public void session(PluginCall call){
        try{call.resolve(new JSObject().put("token",store.token()));}catch(Exception e){call.reject("تعذر قراءة الجلسة");}
    }
    @PluginMethod public void status(PluginCall call){
        try{JSObject result=new JSObject();String user=store.prefs.getString("user","");result.put("user",user.isEmpty()?JSONObject.NULL:new JSONObject(user));result.put("active",store.active());result.put("sessionOpen",store.allowed());result.put("tracking",store.active()&&store.allowed()&&TrackingService.collecting);result.put("pending",store.pending());result.put("error",store.prefs.getString("error",""));result.put("locationLabel",store.prefs.getString("locationLabel",""));result.put("lastPingAt",store.prefs.getLong("last_ping_at",0));result.put("lastSyncAt",store.prefs.getLong("last_sync_at",0));result.put("accuracy",store.prefs.getFloat("last_accuracy",0));result.put("trackingUntil",store.windowEnd());call.resolve(result);}catch(Exception e){call.reject("تعذر قراءة البيانات المحلية");}
    }
    @PluginMethod public void start(PluginCall call){
        if(starting){call.reject("انتظر التقاط GPS");return;}
        if(getPermissionState("location")!=PermissionState.GRANTED){
            requestPermissionForAliases(Build.VERSION.SDK_INT>=33?new String[]{"location","notifications"}:new String[]{"location"},call,"permissionsResult");return;
        }
        getActivity().runOnUiThread(()->begin(call));
    }
    @PermissionCallback private void permissionsResult(PluginCall call){
        if(getPermissionState("location")!=PermissionState.GRANTED){call.reject("اسمح بالموقع الدقيق لبدء الشيفت");return;}
        getActivity().runOnUiThread(()->begin(call));
    }
    private void begin(PluginCall call){
        try {
            if(!new JSONObject(store.prefs.getString("user","{}")).optString("role").equals("employee")){call.reject("حساب موظف مطلوب");return;}
            if(androidx.core.content.ContextCompat.checkSelfPermission(getContext(),Manifest.permission.ACCESS_FINE_LOCATION)!=android.content.pm.PackageManager.PERMISSION_GRANTED){call.reject("فعّل الموقع الدقيق من إعدادات التطبيق، وليس الموقع التقريبي فقط");return;}
            if(!store.hasSchedule()){call.reject("اتصل بالإنترنت لتحديث مواعيد الشيفت أولًا");return;}
            store.setActive(true);getContext().startForegroundService(new Intent(getContext(),TrackingService.class));store.sync();call.resolve();
        }catch(Exception e){call.reject("تعذر تفعيل متابعة الشيفت");}
    }
    @PluginMethod public void stop(PluginCall call){
        try{store.setActive(false);getContext().stopService(new Intent(getContext(),TrackingService.class));store.sync();call.resolve();}catch(Exception e){call.reject("تعذر إيقاف المتابعة");}
    }
    @PluginMethod public void setSchedule(PluginCall call){
        try{store.setSchedule(new JSONObject(call.getString("schedule","{}")));call.resolve();}catch(Exception e){call.reject("مواعيد المتابعة غير صالحة");}
    }
    @PluginMethod public void sync(PluginCall call){store.sync();call.resolve();}
    @PluginMethod public void resetEpoch(PluginCall call){
        try{
            long reset=java.time.Instant.parse(call.getString("resetAt","")).toEpochMilli();
            synchronized(store){if(store.active()&&store.prefs.getLong("shift_started_at",0)<reset){store.setActive(false);getContext().stopService(new Intent(getContext(),TrackingService.class));}}
            call.resolve();
        }catch(Exception e){call.reject("تعذر تحديث بداية السجل");}
    }
    @PluginMethod public void logout(PluginCall call){try{store.logout();call.resolve();}catch(Exception e){call.reject(e.getMessage());}}
    @PluginMethod public void openSettings(PluginCall call){getContext().startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+getContext().getPackageName())));call.resolve();}
    @PluginMethod public void openAdmin(PluginCall call){
        try{
            if(!"admin".equals(new JSONObject(store.prefs.getString("user","{}")).optString("role"))){call.reject("حساب المدير مطلوب");return;}
            String token=store.token();getActivity().runOnUiThread(()->{
                android.webkit.CookieManager.getInstance().setCookie(TrackingStore.API,"auth_token="+token+"; Path=/; Secure; HttpOnly; SameSite=Lax",ok->{getContext().startActivity(new Intent(getContext(),AdminActivity.class));call.resolve();});
            });
        }catch(Exception error){call.reject("تعذر فتح لوحة الأدمين");}
    }
}
