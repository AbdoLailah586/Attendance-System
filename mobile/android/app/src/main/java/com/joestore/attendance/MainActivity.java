package com.joestore.attendance;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle state) {
        registerPlugin(AttendanceTrackingPlugin.class);
        super.onCreate(state);
    }
}
