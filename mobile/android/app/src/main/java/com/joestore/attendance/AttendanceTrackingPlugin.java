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
        try{JSObject result=new JSObject();String user=store.prefs.getString("user","");result.put("user",user.isEmpty()?JSONObject.NULL:new JSONObject(user));result.put("active",store.active());result.put("pending",store.pending());result.put("error",store.prefs.getString("error",""));result.put("locationLabel",store.prefs.getString("locationLabel",""));call.resolve(result);}catch(Exception e){call.reject("تعذر قراءة البيانات المحلية");}
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
        if(store.active()){call.resolve();return;}
        try {if(!new JSONObject(store.prefs.getString("user","{}")).optString("role").equals("employee")){call.reject("حساب موظف مطلوب");return;}}catch(Exception e){call.reject("سجل الدخول أولًا");return;}
        starting=true;
        LocationManager manager=(LocationManager)getContext().getSystemService(android.content.Context.LOCATION_SERVICE);
        Handler handler=new Handler(Looper.getMainLooper());
        final boolean[] completed={false};
        LocationListener listener=new LocationListener(){
            @Override public void onLocationChanged(Location fix){
                if(completed[0]||(Build.VERSION.SDK_INT>=31?fix.isMock():fix.isFromMockProvider())||!fix.hasAccuracy()||System.currentTimeMillis()-fix.getTime()>30000)return;
                completed[0]=true;manager.removeUpdates(this);handler.removeCallbacksAndMessages(null);starting=false;
                try{store.record("clock_in",fix);store.setActive(true);getContext().startForegroundService(new Intent(getContext(),TrackingService.class));store.sync();call.resolve();}
                catch(Exception e){try{store.record("clock_out",null);store.setActive(false);}catch(Exception ignored){} call.reject("تعذر تشغيل التتبع؛ حاول مرة أخرى");}
            }
        };
        boolean requested=false;
        try {
            for(String provider:new String[]{LocationManager.GPS_PROVIDER,LocationManager.NETWORK_PROVIDER})if(manager.isProviderEnabled(provider)){manager.requestLocationUpdates(provider,1000,0,listener,Looper.getMainLooper());requested=true;}
        }catch(SecurityException e){starting=false;call.reject("اسمح بالموقع الدقيق");return;}
        if(!requested){starting=false;call.reject("شغّل GPS ثم حاول مرة أخرى");return;}
        handler.postDelayed(()->{if(!completed[0]){completed[0]=true;manager.removeUpdates(listener);starting=false;call.reject("تعذر التقاط موقع حديث؛ شغّل GPS وحاول مرة أخرى");}},25000);
    }
    @PluginMethod public void stop(PluginCall call){
        try{synchronized(store){if(store.active()){store.record("clock_out",null);store.setActive(false);}}getContext().stopService(new Intent(getContext(),TrackingService.class));store.sync();call.resolve();}catch(Exception e){call.reject("تعذر حفظ الانصراف؛ لم يتوقف الشيفت");}
    }
    @PluginMethod public void sync(PluginCall call){store.sync();call.resolve();}
    @PluginMethod public void logout(PluginCall call){try{store.logout();call.resolve();}catch(Exception e){call.reject(e.getMessage());}}
    @PluginMethod public void openAdmin(PluginCall call){getContext().startActivity(new Intent(Intent.ACTION_VIEW,android.net.Uri.parse(TrackingStore.API)));call.resolve();}
}
