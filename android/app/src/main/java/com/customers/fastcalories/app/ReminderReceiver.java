package com.customers.fastcalories.app;

import android.Manifest;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String title = intent.getStringExtra("title");
        String message = intent.getStringExtra("message");
        int requestCode = intent.getIntExtra("requestCode", (int) System.currentTimeMillis());
        String safeTitle = title == null ? "Medication Reminder" : title;
        String safeMessage = message == null ? "It's time to take your medication." : message;

        Intent openIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (openIntent == null) openIntent = new Intent(context, MainActivity.class);
        PendingIntent openPendingIntent = PendingIntent.getActivity(
                context,
                requestCode,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, ReminderScheduler.CHANNEL_ID)
                .setSmallIcon(context.getApplicationInfo().icon)
                .setContentTitle(safeTitle)
                .setContentText(safeMessage)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(safeMessage))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(openPendingIntent);

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            NotificationManagerCompat.from(context).notify(requestCode, builder.build());
        }

        ReminderScheduler.removeStored(context, requestCode);
    }
}