package com.customers.fastcalories.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.BitmapFactory;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * FastCalories Rider: native active-delivery location sharing.
 *
 * Location foreground service (type=location) started by RiderTrackingPlugin only while the
 * app is visible and the rider has an authorised active delivery. It keeps reading the fused
 * location provider and uploading natively when the WebView/JS is suspended (app switched or
 * screen locked). Uploads go to publish_rider_location_native with a per-delivery tracking
 * token issued by the server (never the rider's session/refresh token).
 *
 * Coalescing: a single latest-only pending fix, one upload in flight, ~1 s cadence when moving,
 * 10 s heartbeat when still. Offline: the latest fix is retried with bounded backoff and
 * dropped once older than 110 s (the server rejects > 2 min). Any server `stop` (delivered,
 * cancelled, reassigned, kill switch, invalid/expired token) removes that delivery; with no
 * deliveries left, or on explicit stop / token expiry, the service stops and clears its state.
 */
public class RiderTrackingService extends Service {
    public static final String ACTION_START = "com.fastcalories.rider.TRACKING_START";
    public static final String ACTION_STOP = "com.fastcalories.rider.TRACKING_STOP";
    static final String PREFS = "rider_tracking";
    private static final String CHANNEL = "rider_tracking";
    private static final int NOTIF_ID = 7301;
    static final long MOVING_INTERVAL_MS = 1000;
    static final long STILL_HEARTBEAT_MS = 10_000;
    static final long MAX_FIX_AGE_MS = 110_000;
    static final float MAX_ACCURACY_M = 1000f;

    // Status shared with the plugin (read-only there).
    static volatile boolean running = false;
    static volatile long lastUploadAt = 0;
    static volatile String lastError = null;
    static volatile int acceptedCount = 0;
    static volatile int activeOrders = 0;

    private FusedLocationProviderClient fused;
    private LocationCallback callback;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService uploader = Executors.newSingleThreadExecutor();
    private final Map<String, String> orders = new LinkedHashMap<>(); // orderId -> token
    private String baseUrl, anonKey;
    private long expiresAt;
    private Location pending, lastSent;
    private boolean inFlight = false;
    private int failures = 0;
    private Runnable retry;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) { stopAndClear("stopped"); return START_NOT_STICKY; }
        if (!loadState()) { stopAndClear("no_state"); return START_NOT_STICKY; }
        try {
            Notification n = buildNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(NOTIF_ID, n);
        } catch (Exception e) {
            // e.g. Android 12+/14 refuses a location FGS start while not visible / permission revoked.
            lastError = "foreground_start_refused";
            stopAndClear(null);
            return START_NOT_STICKY;
        }
        running = true;
        startLocation();
        // Not sticky: a restart after the process is killed would happen while not visible,
        // which Android disallows for location services; the app restarts it when reopened.
        return START_NOT_STICKY;
    }

    private boolean loadState() {
        SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        baseUrl = p.getString("url", null);
        anonKey = p.getString("anon", null);
        expiresAt = p.getLong("expires_at", 0);
        orders.clear();
        try {
            JSONObject o = new JSONObject(p.getString("orders", "{}"));
            Iterator<String> it = o.keys();
            while (it.hasNext()) { String k = it.next(); orders.put(k, o.getString(k)); }
        } catch (Exception ignored) { }
        activeOrders = orders.size();
        return baseUrl != null && anonKey != null && !orders.isEmpty() && System.currentTimeMillis() < expiresAt;
    }

    private void startLocation() {
        if (callback != null) return; // exactly one location request per service
        fused = LocationServices.getFusedLocationProviderClient(this);
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, MOVING_INTERVAL_MS)
            .setMinUpdateIntervalMillis(MOVING_INTERVAL_MS)
            .setWaitForAccurateLocation(false)
            .build();
        callback = new LocationCallback() {
            @Override public void onLocationResult(LocationResult r) {
                Location l = r.getLastLocation();
                if (l != null) onFix(l);
            }
        };
        try {
            fused.requestLocationUpdates(req, callback, Looper.getMainLooper());
        } catch (SecurityException se) {
            lastError = "permission_revoked";
            stopAndClear(null);
        }
    }

    private void onFix(Location l) {
        long now = System.currentTimeMillis();
        if (now >= expiresAt) { stopAndClear("token_expired"); return; }
        if (l.hasAccuracy() && l.getAccuracy() > MAX_ACCURACY_M) return;
        if (Math.abs(l.getLatitude()) < 0.0001 && Math.abs(l.getLongitude()) < 0.0001) return;
        if (!shouldSend(lastSent, l, now)) return;
        pending = l; // latest-only
        pump();
    }

    /** Moving: every fix ≥1 s apart. Still (inside jitter): only a 10 s heartbeat. */
    static boolean shouldSend(Location last, Location next, long now) {
        if (last == null) return true;
        long since = next.getTime() - last.getTime();
        if (since <= 0) return false; // duplicate / out of order
        if (since < MOVING_INTERVAL_MS) return false;
        boolean moving = next.hasSpeed() && next.getSpeed() >= 1.0f;
        float jitter = Math.max(15f, next.hasAccuracy() ? next.getAccuracy() : 15f);
        if (moving || last.distanceTo(next) > jitter) return true;
        return since >= STILL_HEARTBEAT_MS;
    }

    private void pump() {
        if (inFlight || pending == null || retry != null) return;
        final Location fix = pending; pending = null;
        if (System.currentTimeMillis() - fix.getTime() > MAX_FIX_AGE_MS) return;
        inFlight = true;
        final Map<String, String> snapshot = new LinkedHashMap<>(orders);
        uploader.execute(() -> {
            boolean networkFailed = false;
            java.util.List<String> stopped = new java.util.ArrayList<>();
            boolean anyOk = false;
            for (Map.Entry<String, String> e : snapshot.entrySet()) {
                try {
                    JSONObject res = upload(e.getValue(), fix);
                    if (res.optBoolean("ok")) anyOk = true;
                    else if (res.optBoolean("stop")) stopped.add(e.getKey());
                    else lastError = res.optString("reason", "rejected");
                } catch (Exception ex) { networkFailed = true; lastError = "network"; }
            }
            final boolean fNet = networkFailed, fOk = anyOk;
            main.post(() -> afterUpload(fix, fNet, fOk, stopped));
        });
    }

    private void afterUpload(Location fix, boolean networkFailed, boolean ok, java.util.List<String> stopped) {
        inFlight = false;
        if (!running) return;
        for (String id : stopped) orders.remove(id);
        activeOrders = orders.size();
        if (!stopped.isEmpty()) persistOrders();
        if (orders.isEmpty()) { stopAndClear("no_active_delivery"); return; }
        if (ok) { lastSent = fix; lastUploadAt = System.currentTimeMillis(); acceptedCount++; failures = 0; lastError = null; }
        if (networkFailed) {
            if (pending == null || pending.getTime() < fix.getTime()) pending = fix; // keep the newest only
            failures++;
            long wait = Math.min(30_000L, 1000L << Math.min(5, failures - 1));
            retry = () -> { retry = null; pump(); };
            main.postDelayed(retry, wait);
            return;
        }
        pump();
    }

    private JSONObject upload(String token, Location fix) throws Exception {
        URL url = new URL(baseUrl + "/rest/v1/rpc/publish_rider_location_native");
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setConnectTimeout(8000); c.setReadTimeout(8000);
        c.setRequestMethod("POST"); c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setRequestProperty("apikey", anonKey);
        c.setRequestProperty("Authorization", "Bearer " + anonKey);
        JSONObject body = new JSONObject();
        body.put("p_token", token);
        body.put("p_lat", fix.getLatitude());
        body.put("p_lng", fix.getLongitude());
        body.put("p_accuracy", fix.hasAccuracy() ? fix.getAccuracy() : JSONObject.NULL);
        body.put("p_heading", fix.hasBearing() ? fix.getBearing() : JSONObject.NULL);
        body.put("p_speed", fix.hasSpeed() ? Math.min(70f, fix.getSpeed()) : JSONObject.NULL);
        body.put("p_captured_at", iso(Math.min(System.currentTimeMillis(), fix.getTime())));
        try (OutputStream os = c.getOutputStream()) { os.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
        int code = c.getResponseCode();
        if (code >= 500 || code == 429) throw new java.io.IOException("http_" + code);
        java.io.InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        StringBuilder sb = new StringBuilder();
        if (in != null) try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line; while ((line = r.readLine()) != null) sb.append(line);
        }
        c.disconnect();
        if (code >= 400) { JSONObject j = new JSONObject(); j.put("ok", false); j.put("reason", "http_" + code); return j; }
        return new JSONObject(sb.length() == 0 ? "{}" : sb.toString());
    }

    private static String iso(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(ms));
    }

    private void persistOrders() {
        JSONObject o = new JSONObject();
        try { for (Map.Entry<String, String> e : orders.entrySet()) o.put(e.getKey(), e.getValue()); } catch (Exception ignored) { }
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("orders", o.toString()).apply();
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Delivery location sharing", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while your location is shared with the customer for an active delivery");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = PendingIntent.getActivity(this, 0, open == null ? new Intent() : open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_rider)
            .setLargeIcon(BitmapFactory.decodeResource(getResources(), R.drawable.ic_rider_large))
            .setColor(ContextCompat.getColor(this, R.color.notificationAccent))
            .setContentTitle("FastCalories Rider")
            .setContentText("Sharing your location with the customer for your active delivery")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(pi)
            .build();
    }

    /** Stops updates, the service and clears all stored tokens and the pending fix. */
    private void stopAndClear(String reason) {
        if (reason != null) lastError = reason;
        running = false;
        if (fused != null && callback != null) fused.removeLocationUpdates(callback);
        callback = null; pending = null; lastSent = null;
        if (retry != null) { main.removeCallbacks(retry); retry = null; }
        orders.clear(); activeOrders = 0;
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    @Override public void onDestroy() {
        if (running) stopAndClear(null);
        uploader.shutdownNow();
        super.onDestroy();
    }
}
