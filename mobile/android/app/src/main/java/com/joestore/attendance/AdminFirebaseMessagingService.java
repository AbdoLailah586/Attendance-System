package com.joestore.attendance;

import android.content.Context;
import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class AdminFirebaseMessagingService extends FirebaseMessagingService {

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        AdminReports.sendTokenToServer(getApplicationContext(), token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Context c = getApplicationContext();
        Map<String, String> data = remoteMessage.getData();
        String title = null;
        String body = null;

        if (remoteMessage.getNotification() != null) {
            title = remoteMessage.getNotification().getTitle();
            body = remoteMessage.getNotification().getBody();
        }
        if (data.containsKey("title")) title = data.get("title");
        if (data.containsKey("body")) body = data.get("body");
        if (title == null || title.isEmpty()) title = "إدارة جو ستور";
        if (body == null || body.isEmpty()) body = "تنبيه جديد من نظام الحضور";

        String kind = data.get("kind");
        String day = data.get("business_day");
        if (day == null) day = data.get("day");
        if (day == null) day = "";

        int employee = 0;
        try {
            if (data.containsKey("employee")) employee = Integer.parseInt(data.get("employee"));
            else if (data.containsKey("user_id")) employee = Integer.parseInt(data.get("user_id"));
        } catch (Exception ignored) {}

        TrackingStore store = TrackingStore.get(c);
        int owner = store.userId();
        String authToken = null;
        try {
            authToken = store.token();
        } catch (Exception ignored) {}

        boolean isPdf = "daily_pdf".equals(kind) || "weekly_pdf".equals(kind) || "monthly_pdf".equals(kind);
        if (isPdf && data.containsKey("report_url") && authToken != null && !authToken.isEmpty()) {
            String filename = data.get("filename");
            if (filename == null || filename.isEmpty()) filename = "attendance-" + day + ".pdf";
            try {
                AdminReports.downloadPdf(c, data.get("report_url"), filename, authToken);
            } catch (Exception ignored) {}
            AdminReports.notify(c, (day + kind).hashCode(), title, body, day, employee, owner, true);
        } else {
            int notifId = data.containsKey("key") ? data.get("key").hashCode() : (int) (System.currentTimeMillis() & 0xfffffff);
            AdminReports.notify(c, notifId, title, body, day, employee, owner, false);
        }
    }
}
