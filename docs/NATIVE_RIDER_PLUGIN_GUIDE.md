# Native Android Rider Plugin Implementation Guide

## Overview
This guide covers implementing the native Kotlin side of `RiderServicePlugin` for the FastCalories Rider app.

## Prerequisites
1. Export project to GitHub
2. Run `npm install && npx cap add android`
3. Open `android/` folder in Android Studio

## File Structure (create these in Android Studio)

```
android/app/src/main/java/app/lovable/.../
├── plugins/
│   ├── RiderServicePlugin.kt          # Capacitor plugin bridge
│   ├── RiderForegroundService.kt      # Android Foreground Service
│   ├── DispatchActionReceiver.kt      # BroadcastReceiver for notification actions
│   └── FloatingOverlayService.kt      # Optional: SYSTEM_ALERT_WINDOW overlay
└── MainActivity.kt                     # Register plugin here
```

## Step 1: Register Plugin in MainActivity

```kotlin
// MainActivity.kt
import app.lovable.plugins.RiderServicePlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(RiderServicePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
```

## Step 2: RiderServicePlugin.kt

```kotlin
package app.lovable.plugins

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "RiderServicePlugin")
class RiderServicePlugin : Plugin() {

    @PluginMethod
    fun startForegroundService(call: PluginCall) {
        val title = call.getString("title") ?: "FastCalories Rider"
        val body = call.getString("body") ?: "You are online"
        val channelId = call.getString("channelId") ?: "rider_foreground"

        val intent = Intent(context, RiderForegroundService::class.java).apply {
            putExtra("title", title)
            putExtra("body", body)
            putExtra("channelId", channelId)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        call.resolve()
    }

    @PluginMethod
    fun stopForegroundService(call: PluginCall) {
        val intent = Intent(context, RiderForegroundService::class.java)
        context.stopService(intent)
        call.resolve()
    }

    @PluginMethod
    fun isForegroundServiceRunning(call: PluginCall) {
        val ret = JSObject()
        ret.put("running", RiderForegroundService.isRunning)
        call.resolve(ret)
    }

    @PluginMethod
    fun showHeadsUpNotification(call: PluginCall) {
        val title = call.getString("title") ?: "New Delivery!"
        val body = call.getString("body") ?: ""
        val offerId = call.getString("offerId") ?: ""
        val riderShare = call.getDouble("riderShare") ?: 0.0
        val distanceKm = call.getDouble("distanceKm") ?: 0.0
        val vendorName = call.getString("vendorName") ?: ""
        val timeoutSeconds = call.getInt("timeoutSeconds") ?: 90

        showDispatchNotification(
            context, title, body, offerId,
            riderShare, distanceKm, vendorName, timeoutSeconds
        )
        call.resolve()
    }

    @PluginMethod
    fun dismissHeadsUpNotification(call: PluginCall) {
        val offerId = call.getString("offerId") ?: ""
        dismissNotification(context, offerId)
        call.resolve()
    }

    // Emit events back to web layer
    fun emitDispatchAction(action: String, offerId: String) {
        val data = JSObject()
        data.put("action", action)
        data.put("offerId", offerId)
        notifyListeners("dispatchAction", data)
    }

    fun emitToggleOffline() {
        notifyListeners("toggleOffline", JSObject())
    }
}
```

## Step 3: RiderForegroundService.kt

```kotlin
package app.lovable.plugins

import android.app.*
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class RiderForegroundService : Service() {

    companion object {
        var isRunning = false
        const val CHANNEL_ID = "rider_foreground"
        const val NOTIFICATION_ID = 1001
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val title = intent?.getStringExtra("title") ?: "FastCalories Rider"
        val body = intent?.getStringExtra("body") ?: "You are online"

        // Open app intent
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val openPending = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Go offline action
        val offlineIntent = Intent(this, DispatchActionReceiver::class.java).apply {
            action = "TOGGLE_OFFLINE"
        }
        val offlinePending = PendingIntent.getBroadcast(
            this, 1, offlineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.drawable.ic_notification) // Add your icon
            .setOngoing(true)
            .setContentIntent(openPending)
            .addAction(0, "Go Offline", offlinePending)
            .build()

        startForeground(NOTIFICATION_ID, notification)
        isRunning = true
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Rider Status",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when rider is online and available"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }
}
```

## Step 4: DispatchActionReceiver.kt

```kotlin
package app.lovable.plugins

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class DispatchActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            "ACCEPT_DISPATCH" -> {
                val offerId = intent.getStringExtra("offerId") ?: return
                // Send event back to Capacitor plugin
                RiderServicePluginBridge.emitAction("accept", offerId)
            }
            "REJECT_DISPATCH" -> {
                val offerId = intent.getStringExtra("offerId") ?: return
                RiderServicePluginBridge.emitAction("reject", offerId)
            }
            "TOGGLE_OFFLINE" -> {
                RiderServicePluginBridge.emitToggleOffline()
            }
        }
    }
}
```

## Step 5: Heads-Up Notification Helper

```kotlin
fun showDispatchNotification(
    context: Context,
    title: String,
    body: String,
    offerId: String,
    riderShare: Double,
    distanceKm: Double,
    vendorName: String,
    timeoutSeconds: Int
) {
    val channelId = "dispatch_alerts"

    // Create high-priority channel
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val channel = NotificationChannel(
            channelId, "Delivery Requests",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "New delivery request alerts"
            enableVibration(true)
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    // Accept action
    val acceptIntent = Intent(context, DispatchActionReceiver::class.java).apply {
        action = "ACCEPT_DISPATCH"
        putExtra("offerId", offerId)
    }
    val acceptPending = PendingIntent.getBroadcast(
        context, offerId.hashCode(),
        acceptIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    // Reject action
    val rejectIntent = Intent(context, DispatchActionReceiver::class.java).apply {
        action = "REJECT_DISPATCH"
        putExtra("offerId", offerId)
    }
    val rejectPending = PendingIntent.getBroadcast(
        context, offerId.hashCode() + 1,
        rejectIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val notification = NotificationCompat.Builder(context, channelId)
        .setContentTitle(title)
        .setContentText("$vendorName • ₦${riderShare.toInt()} • ${String.format("%.1f", distanceKm)}km")
        .setSmallIcon(R.drawable.ic_notification)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setAutoCancel(true)
        .setTimeoutAfter(timeoutSeconds * 1000L)
        .addAction(0, "✅ ACCEPT", acceptPending)
        .addAction(0, "❌ REJECT", rejectPending)
        .build()

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(offerId.hashCode(), notification)
}

fun dismissNotification(context: Context, offerId: String) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(offerId.hashCode())
}
```

## Step 6: AndroidManifest.xml additions

```xml
<!-- Inside <manifest> -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" /> <!-- For overlay -->
<uses-permission android:name="android.permission.VIBRATE" />

<!-- Inside <application> -->
<service
    android:name=".plugins.RiderForegroundService"
    android:foregroundServiceType="location"
    android:exported="false" />

<receiver
    android:name=".plugins.DispatchActionReceiver"
    android:exported="false">
    <intent-filter>
        <action android:name="ACCEPT_DISPATCH" />
        <action android:name="REJECT_DISPATCH" />
        <action android:name="TOGGLE_OFFLINE" />
    </intent-filter>
</receiver>
```

## Step 7: Sync and Test

```bash
npx cap sync android
npx cap run android
```

## How It Works (End-to-End)

1. **Rider goes online** → Web calls `useRiderNativeService` → starts foreground service → persistent notification appears
2. **New dispatch offer** → Supabase Realtime fires → `RiderLayout` calls `showOfferNotification()` → native heads-up with ACCEPT/REJECT buttons
3. **Rider taps ACCEPT** → `DispatchActionReceiver` fires → emits `dispatchAction` event to Capacitor → web calls `acceptOffer()` API
4. **Rider goes offline** → Taps "Go Offline" in notification → emits `toggleOffline` → web sets online to false → foreground service stops
