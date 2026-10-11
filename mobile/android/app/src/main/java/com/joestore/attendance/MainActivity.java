package com.joestore.attendance;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle state) {
        registerPlugin(AttendanceTrackingPlugin.class);
        registerPlugin(AdminReportsPlugin.class);
        super.onCreate(state);
    }
    @Override public void onNewIntent(android.content.Intent intent){super.onNewIntent(intent);setIntent(intent);}
}
