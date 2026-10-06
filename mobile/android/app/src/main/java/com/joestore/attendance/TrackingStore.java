package com.joestore.attendance;

import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.TimeUnit;
import androidx.work.*;

final class TrackingStore extends SQLiteOpenHelper {
    static final String API = "https://attendance-system-joe-2026.vercel.app";
    private static TrackingStore instance;
    static final ExecutorService NETWORK = Executors.newSingleThreadExecutor();
    final SharedPreferences prefs;
    final Context context;
    private final AtomicBoolean syncing = new AtomicBoolean(false);
    private int sessionGeneration=0;
    private TrackingStore(Context context) {
        super(context, "attendance-events.db", null, 1);
        prefs = context.getSharedPreferences("attendance", Context.MODE_PRIVATE);
        this.context = context;
    }
    static synchronized TrackingStore get(Context context) {
        if (instance == null) instance = new TrackingStore(context.getApplicationContext());
        return instance;
    }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE events(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, payload TEXT NOT NULL, time INTEGER NOT NULL)");
        db.execSQL("CREATE INDEX event_order ON events(user_id,time)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}
    private SecretKey key() throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        if (!keys.containsAlias("attendance-token")) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("attendance-token", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) keys.getKey("attendance-token", null);
    }
    synchronized void configure(String token, String user) throws Exception {
        JSONObject identity = new JSONObject(user);
        if ((active() || pending() > 0) && identity.getInt("id") != userId()) throw new Exception("زامن الأحداث وأنهِ الشيفت قبل تبديل الحساب");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        String encrypted = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(token.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        SharedPreferences.Editor edit=prefs.edit().putString("token", encrypted).putString("user", user).putString("error", "");
        if(identity.getInt("id")!=userId())edit.putString("windows","[]").putLong("schedule_until",0).remove("locationLabel").remove("last_ping_at").remove("last_sync_at");
        if(!"employee".equals(identity.optString("role"))){edit.putBoolean("active",false).putString("windows","[]");context.stopService(new android.content.Intent(context,TrackingService.class));}
        if (!edit.commit()) throw new Exception("تعذر حفظ الجلسة");
        sessionGeneration++;
        scheduleSync();
    }
    synchronized String token() throws Exception {
        String encrypted = prefs.getString("token", ""); if (encrypted.isEmpty()) return "";
        String[] parts = encrypted.split(":");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
    synchronized int userId() {
        try { return new JSONObject(prefs.getString("user", "{}")).getInt("id"); } catch (Exception e) { return 0; }
    }
    synchronized boolean active() { return prefs.getBoolean("active", false); }
    synchronized void setActive(boolean active) throws Exception {
        android.content.SharedPreferences.Editor edit=prefs.edit().putBoolean("active", active);
        if(active)edit.putLong("shift_started_at",System.currentTimeMillis());
        if (!edit.commit()) throw new Exception("تعذر حفظ حالة الشيفت");
    }
    synchronized int pending() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM events WHERE user_id=?", new String[]{String.valueOf(userId())})) { c.moveToFirst(); return c.getInt(0); }
    }
    synchronized void record(String type, android.location.Location location) throws Exception {
        if (userId() == 0) throw new Exception("سجل الدخول أولًا");
        long time = location == null ? System.currentTimeMillis() : location.getTime();
        if(location!=null&&!allowedAt(time))return;
        JSONObject event = new JSONObject();
        String id = UUID.randomUUID().toString();
        event.put("client_event_id", id); event.put("recorded_at", Instant.ofEpochMilli(time).toString()); event.put("event_type", type);
        event.put("lat", location == null ? JSONObject.NULL : location.getLatitude());
        event.put("lng", location == null ? JSONObject.NULL : location.getLongitude());
        event.put("accuracy", location == null ? JSONObject.NULL : location.getAccuracy());
        getWritableDatabase().execSQL("INSERT INTO events(id,user_id,payload,time) VALUES(?,?,?,?)", new Object[]{id,userId(),event.toString(),time});
        if(location!=null)prefs.edit().putLong("last_ping_at",time).putFloat("last_accuracy",location.getAccuracy()).apply();
        scheduleSync();
    }
    synchronized void recordPing(android.location.Location location) throws Exception {
        if (active() && allowed()) record("ping", location);
    }
    synchronized void setSchedule(JSONObject schedule) throws Exception {
        JSONArray windows=schedule.getJSONArray("windows");
        if(!prefs.edit().putString("windows",windows.toString()).putLong("schedule_until",schedule.getLong("valid_until")).putInt("ping_secs",schedule.optInt("ping_interval_secs",60)).commit())throw new Exception("Cannot save schedule");
    }
    synchronized boolean hasSchedule(){return prefs.getLong("schedule_until",0)>System.currentTimeMillis();}
    synchronized long windowEnd(){return windowEndAt(System.currentTimeMillis());}
    synchronized long windowEndAt(long time){
        try{JSONArray windows=new JSONArray(prefs.getString("windows","[]"));
            for(int i=0;i<windows.length();i++){JSONObject w=windows.getJSONObject(i);if(time>=w.getLong("start")&&time<w.getLong("end"))return w.getLong("end");}
        }catch(Exception ignored){}return 0;
    }
    synchronized boolean allowed(){return hasSchedule()&&windowEnd()>0;}
    synchronized boolean allowedAt(long time){return hasSchedule()&&time>0&&time<=System.currentTimeMillis()+10000&&windowEndAt(time)>0;}
    private final AtomicBoolean fetchingSchedule=new AtomicBoolean(false);
    void refreshSchedule(){
        if(!fetchingSchedule.compareAndSet(false,true))return;
        NETWORK.execute(()->{try{
            String credential;int owner,generation;synchronized(this){credential=token();owner=userId();generation=sessionGeneration;}if(credential.isEmpty())return;
            HttpsURLConnection c=(HttpsURLConnection)new URL(API+"/api/attendance/tracking-window").openConnection();
            try{c.setConnectTimeout(10000);c.setReadTimeout(10000);c.setInstanceFollowRedirects(false);c.setRequestProperty("Authorization","Bearer "+credential);
                int code=c.getResponseCode();if(code==401){synchronized(this){if(owner==userId()&&generation==sessionGeneration){prefs.edit().putString("windows","[]").apply();error("الجلسة تحتاج تجديدًا؛ سجل الدخول بنفس الحساب");}}return;}if(code!=200)return;
                try(java.io.InputStream stream=c.getInputStream();java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream()){
                    byte[] buffer=new byte[4096];int n;while((n=stream.read(buffer))!=-1)bytes.write(buffer,0,n);synchronized(this){if(owner==userId()&&generation==sessionGeneration)setSchedule(new JSONObject(bytes.toString(StandardCharsets.UTF_8.name())));}
                }
            }finally{c.disconnect();}
        }catch(Exception ignored){}finally{fetchingSchedule.set(false);}});
    }
    void error(String message) { prefs.edit().putString("error", message).apply(); }
    synchronized void logout() throws Exception {
        if (active() || pending() > 0) throw new Exception("أنهِ الشيفت وزامن الأحداث قبل تسجيل الخروج");
        if(!prefs.edit().clear().commit())throw new Exception("تعذر مسح الجلسة المحلية");
        sessionGeneration++;
        android.webkit.CookieManager.getInstance().setCookie(API,"auth_token=; Max-Age=0; Path=/; Secure; HttpOnly");
    }
    void sync() {
        if (!syncing.compareAndSet(false,true)) return;
        NETWORK.execute(() -> {
            try {
                for (int batchNumber=0; batchNumber<20; batchNumber++) {
                    JSONArray events = new JSONArray(); int owner;
                    String credential;
                    synchronized (this) {
                        owner = userId(); credential = token(); if (owner == 0 || credential.isEmpty()) return;
                        try (Cursor c = getReadableDatabase().rawQuery("SELECT payload FROM events WHERE user_id=? ORDER BY time,id LIMIT 100", new String[]{String.valueOf(owner)})) {
                            while (c.moveToNext()) events.put(new JSONObject(c.getString(0)));
                        }
                    }
                    if (events.length() == 0) return;
                    HttpsURLConnection connection = (HttpsURLConnection) new URL(API + "/api/attendance/ping").openConnection();
                    try {
                        connection.setConnectTimeout(15000); connection.setReadTimeout(20000); connection.setInstanceFollowRedirects(false);
                        connection.setRequestMethod("POST"); connection.setDoOutput(true);
                        connection.setRequestProperty("Authorization", "Bearer " + credential); connection.setRequestProperty("Content-Type", "application/json");
                        byte[] body = new JSONObject().put("events", events).toString().getBytes(StandardCharsets.UTF_8);
                        try (java.io.OutputStream stream=connection.getOutputStream()) { stream.write(body); }
                        int code=connection.getResponseCode();
                        if (code < 200 || code >= 300) {
                            error(code==401 ? "انتهت الجلسة؛ سجل الدخول بنفس الحساب للمزامنة" : "المزامنة مؤجلة؛ الأحداث محفوظة على الهاتف ("+code+")"); return;
                        }
                        String response;
                        try (java.io.InputStream stream=connection.getInputStream(); java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream()) { byte[] buffer=new byte[4096];int n;while((n=stream.read(buffer))!=-1)bytes.write(buffer,0,n);response=bytes.toString(StandardCharsets.UTF_8.name()); }
                        JSONObject result=new JSONObject(response); JSONArray accepted=result.getJSONArray("acknowledged");
                        if (accepted.length()==0) return;
                        synchronized (this) {
                            SQLiteDatabase db=getWritableDatabase(); db.beginTransaction();
                            try { for(int i=0;i<accepted.length();i++) db.delete("events","id=? AND user_id=?",new String[]{accepted.getJSONObject(i).getString("client_event_id"),String.valueOf(owner)}); db.setTransactionSuccessful(); } finally {db.endTransaction();}
                            JSONObject geo=result.optJSONObject("location");
                            if(owner==userId()){SharedPreferences.Editor edit=prefs.edit().putLong("last_sync_at",System.currentTimeMillis());if(geo!=null)edit.putString("locationLabel",geo.optString("branch_name", ""));edit.apply();}
                        }
                        error("");
                    } finally { connection.disconnect(); }
                }
            } catch(Exception e) {error("تعذر الاتصال؛ الأحداث محفوظة للمزامنة لاحقًا");}
            finally { syncing.set(false); }
        });
    }
    private void scheduleSync() {
        Constraints network = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        WorkManager.getInstance(context).enqueueUniqueWork("attendance-upload",ExistingWorkPolicy.KEEP,
            new OneTimeWorkRequest.Builder(AttendanceUploadWorker.class).setConstraints(network).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build());
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("attendance-retry",ExistingPeriodicWorkPolicy.KEEP,
            new PeriodicWorkRequest.Builder(AttendanceUploadWorker.class,15,TimeUnit.MINUTES).setConstraints(network).build());
    }
}
