package com.joestore.attendance;
import android.Manifest;
import android.os.Build;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
@CapacitorPlugin(name="AdminReports",permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class AdminReportsPlugin extends Plugin {
    private boolean authorized(){return AdminReports.admin(TrackingStore.get(getContext()));}
    @PluginMethod public void status(PluginCall call){
        if(!authorized()){call.reject("حساب المدير مطلوب");return;}
        JSObject result=new JSObject();result.put("enabled",AdminReports.enabled(getContext()));result.put("permission",AdminReports.permitted(getContext()));
        result.put("nextDue",AdminReports.prefs(getContext()).getString("next_due",""));result.put("lastSync",AdminReports.prefs(getContext()).getLong("last_sync",0));result.put("error",AdminReports.prefs(getContext()).getString("error",""));call.resolve(result);
    }
    @PluginMethod public void enable(PluginCall call){
        if(!authorized()){call.reject("حساب المدير مطلوب");return;}
        if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){requestPermissionForAlias("notifications",call,"permissionResult");return;}
        finishEnable(call);
    }
    @PermissionCallback private void permissionResult(PluginCall call){
        if(getPermissionState("notifications")!=PermissionState.GRANTED){call.reject("اسمح بالإشعارات من إعدادات التطبيق");return;}finishEnable(call);
    }
    private void finishEnable(PluginCall call){if(!authorized()){call.reject("حساب المدير مطلوب");return;}if(!AdminReports.permitted(getContext())){call.reject("فعّل إشعارات تقارير الشيفت من إعدادات التطبيق");return;}AdminReports.enable(getContext());call.resolve();}
    @PluginMethod public void disable(PluginCall call){AdminReports.clear(getContext());call.resolve();}
    @PluginMethod public void refresh(PluginCall call){if(!authorized()){call.reject("حساب المدير مطلوب");return;}AdminReports.refresh(getContext());call.resolve();}
    @PluginMethod public void test(PluginCall call){if(!authorized()||!AdminReports.permitted(getContext())){call.reject("فعّل إشعارات المدير أولًا");return;}AdminReports.notify(getContext(),8801,"إشعار اختبار إدارة جو ستور","الإشعارات مفعّلة؛ تقرير كل موظف يظهر بعد نهاية شيفته.","",0,TrackingStore.get(getContext()).userId());call.resolve();}
    @PluginMethod public void launch(PluginCall call){
        JSObject result=new JSObject();android.content.Intent intent=getActivity().getIntent();TrackingStore store=TrackingStore.get(getContext());
        if(authorized()&&intent.getIntExtra("report_owner",0)==store.userId()){result.put("day",intent.getStringExtra("report_day"));result.put("employee",intent.getIntExtra("report_employee",0));intent.removeExtra("report_day");intent.removeExtra("report_employee");intent.removeExtra("report_owner");}call.resolve(result);
    }
}
