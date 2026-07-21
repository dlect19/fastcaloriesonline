package com.customers.fastcalories.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

class ReminderScheduler {
    static final String CHANNEL_ID = "drug_reminders";
    private static final String PREFS = "fastcalories_reminder_plugin";
    private static final String KEY_REMINDERS = "reminders";

    static void schedule(Context context, String title, String message, long triggerTime, boolean persist) throws JSONException {
        createChannel(context);
        int requestCode = Math.abs((title + message + triggerTime).hashCode());
        Intent intent = new Intent(context, ReminderReceiver.class);
        intent.putExtra("title", title);
        intent.putExtra("message", message);
        intent.putExtra("requestCode", requestCode);

        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent);
        } else {
            alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent);
        }

        if (persist) saveReminder(context, title, message, triggerTime);
    }

    static void rescheduleStored(Context context) {
        try {
            long now = System.currentTimeMillis();
            JSONArray active = new JSONArray();
            JSONArray stored = getStored(context);
            for (int i = 0; i < stored.length(); i++) {
                JSONObject item = stored.getJSONObject(i);
                long triggerTime = item.optLong("triggerTime", 0);
                if (triggerTime <= now) continue;
                String title = item.optString("title", "Medication Reminder");
                String message = item.optString("message", "It's time to take your medication.");
                schedule(context, title, message, triggerTime, false);
                active.put(item);
            }
            getPrefs(context).edit().putString(KEY_REMINDERS, active.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    static void removeStored(Context context, int requestCode) {
        try {
            JSONArray active = new JSONArray();
            JSONArray stored = getStored(context);
            for (int i = 0; i < stored.length(); i++) {
                JSONObject item = stored.getJSONObject(i);
                int code = Math.abs((item.optString("title") + item.optString("message") + item.optLong("triggerTime")).hashCode());
                if (code != requestCode) active.put(item);
            }
            getPrefs(context).edit().putString(KEY_REMINDERS, active.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    private static void saveReminder(Context context, String title, String message, long triggerTime) throws JSONException {
        JSONArray stored = getStored(context);
        JSONObject item = new JSONObject();
        item.put("title", title);
        item.put("message", message);
        item.put("triggerTime", triggerTime);
        stored.put(item);
        getPrefs(context).edit().putString(KEY_REMINDERS, stored.toString()).apply();
    }

    private static JSONArray getStored(Context context) throws JSONException {
        String raw = getPrefs(context).getString(KEY_REMINDERS, "[]");
        return new JSONArray(raw == null ? "[]" : raw);
    }

    private static SharedPreferences getPrefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Medication Alarms",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("High-priority medication reminders");
        channel.enableVibration(true);

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }
}