package com.customers.fastcalories.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Handles FCM data-only messages. For type=CALL, shows a full-screen
 * "phone-style" incoming-call notification that wakes the device.
 */
public class FastCaloriesMessagingService extends FirebaseMessagingService {
    private static final String TAG = "FCFCM";
    private static final String CALL_CHANNEL_ID = "order-calls-v6";

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (data == null || data.isEmpty()) return;

        String type = data.get("type");
        if (!"CALL".equalsIgnoreCase(type)) {
            // Non-call notifications are handled by Capacitor's default plugin.
            return;
        }

        String callId = data.get("callId");
        String title = data.getOrDefault("title", "Incoming call");
        String body = data.getOrDefault("body", "Tap to answer");
        String url = data.getOrDefault("url", callId != null ? "/?call=" + callId : "/");

        try {
            ensureCallChannel();
            showIncomingCall(callId, title, body, url);
        } catch (Exception e) {
            Log.e(TAG, "showIncomingCall failed", e);
        }
    }

    @Override
    public void onNewToken(String token) {
        // Capacitor push plugin owns token registration; nothing to do here.
    }

    private void ensureCallChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CALL_CHANNEL_ID) != null) return;

        NotificationChannel ch = new NotificationChannel(
                CALL_CHANNEL_ID, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Ringing notifications for in-app calls");
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 800, 600, 800, 600, 800});
        ch.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        ch.setSound(ringtone, attrs);
        nm.createNotificationChannel(ch);
    }

    private void showIncomingCall(String callId, String title, String body, String url) {
        Context ctx = getApplicationContext();
        int notifId = callId != null ? callId.hashCode() : (int) System.currentTimeMillis();

        // Full-screen activity that shows on lockscreen and hands off to MainActivity on tap.
        Intent fullScreen = new Intent(ctx, IncomingCallActivity.class)
                .putExtra("callId", callId)
                .putExtra("url", url)
                .putExtra("title", title)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent fullScreenPi = PendingIntent.getActivity(ctx, notifId, fullScreen, piFlags);

        // Tap → open MainActivity with the call deep link.
        Intent tap = new Intent(ctx, MainActivity.class)
                .setData(Uri.parse("https://app.fastcalories.online" + url))
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tapPi = PendingIntent.getActivity(ctx, notifId + 1, tap, piFlags);

        Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CALL_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(true)
                .setSound(ringtone)
                .setVibrate(new long[]{0, 800, 600, 800, 600, 800})
                .setFullScreenIntent(fullScreenPi, true)
                .setContentIntent(tapPi);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(notifId, builder.build());
    }
}
