# Native Android Rider Plugin Implementation Guide

## Overview
This guide covers implementing the native Kotlin side of `RiderServicePlugin` for the FastCalories Rider app. Includes foreground service, heads-up dispatch notifications, and a floating overlay widget visible on the home screen.

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
│   └── FloatingOverlayService.kt      # SYSTEM_ALERT_WINDOW floating bubble
└── MainActivity.kt                     # Register plugin here
```

## Step 1: Register Plugin in MainActivity

```kotlin
// MainActivity.kt
package app.lovable.35bd9daf0ce94743a361ec2d45be6932

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import app.lovable.35bd9daf0ce94743a361ec2d45be6932.plugins.RiderServicePlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(RiderServicePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
```

## Step 2: RiderServicePlugin.kt

```kotlin
package app.lovable.35bd9daf0ce94743a361ec2d45be6932.plugins

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "RiderServicePlugin")
class RiderServicePlugin : Plugin() {

    companion object {
        var instance: RiderServicePlugin? = null
    }

    override fun load() {
        instance = this
    }

    // ── Foreground Service ──

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

    // ── Heads-Up Notification ──

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
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(offerId.hashCode())
        call.resolve()
    }

    // ── Floating Overlay ──

    @PluginMethod
    fun requestOverlayPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.canDrawOverlays(context)) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${context.packageName}")
                )
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                context.startActivity(intent)
                // User needs to toggle and come back - can't get immediate result
                val ret = JSObject()
                ret.put("granted", false)
                call.resolve(ret)
                return
            }
        }
        val ret = JSObject()
        ret.put("granted", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun hasOverlayPermission(call: PluginCall) {
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }
        val ret = JSObject()
        ret.put("granted", granted)
        call.resolve(ret)
    }

    @PluginMethod
    fun showFloatingOverlay(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            call.reject("Overlay permission not granted")
            return
        }

        val intent = Intent(context, FloatingOverlayService::class.java).apply {
            action = "SHOW"
            putExtra("orderNumber", call.getString("orderNumber") ?: "")
            putExtra("vendorName", call.getString("vendorName") ?: "")
            putExtra("statusLabel", call.getString("statusLabel") ?: "")
            putExtra("deliveryFee", call.getDouble("deliveryFee") ?: 0.0)
            putExtra("distanceKm", call.getDouble("distanceKm") ?: 0.0)
        }
        context.startService(intent)
        call.resolve()
    }

    @PluginMethod
    fun updateFloatingOverlay(call: PluginCall) {
        val intent = Intent(context, FloatingOverlayService::class.java).apply {
            action = "UPDATE"
            call.getString("orderNumber")?.let { putExtra("orderNumber", it) }
            call.getString("vendorName")?.let { putExtra("vendorName", it) }
            call.getString("statusLabel")?.let { putExtra("statusLabel", it) }
            call.getDouble("deliveryFee")?.let { putExtra("deliveryFee", it) }
            call.getDouble("distanceKm")?.let { putExtra("distanceKm", it) }
        }
        context.startService(intent)
        call.resolve()
    }

    @PluginMethod
    fun hideFloatingOverlay(call: PluginCall) {
        val intent = Intent(context, FloatingOverlayService::class.java)
        context.stopService(intent)
        call.resolve()
    }

    // ── Event Emitters (called from BroadcastReceiver) ──

    fun emitDispatchAction(action: String, offerId: String) {
        val data = JSObject()
        data.put("action", action)
        data.put("offerId", offerId)
        notifyListeners("dispatchAction", data)
    }

    fun emitToggleOffline() {
        notifyListeners("toggleOffline", JSObject())
    }

    fun emitOverlayTapped() {
        notifyListeners("overlayTapped", JSObject())
    }

    // ── Notification Helper ──

    private fun showDispatchNotification(
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

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId, "Delivery Requests",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "New delivery request alerts"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500, 200, 500)
            }
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }

        val acceptIntent = Intent(context, DispatchActionReceiver::class.java).apply {
            action = "ACCEPT_DISPATCH"
            putExtra("offerId", offerId)
        }
        val acceptPending = PendingIntent.getBroadcast(
            context, offerId.hashCode(),
            acceptIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

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
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setTimeoutAfter(timeoutSeconds * 1000L)
            .setVibrate(longArrayOf(0, 500, 200, 500))
            .addAction(0, "✅ ACCEPT", acceptPending)
            .addAction(0, "❌ REJECT", rejectPending)
            .build()

        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(offerId.hashCode(), notification)
    }
}
```

## Step 3: RiderForegroundService.kt

```kotlin
package app.lovable.35bd9daf0ce94743a361ec2d45be6932.plugins

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
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

        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val openPending = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

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
            .setSmallIcon(android.R.drawable.ic_dialog_info)
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
                description = "Shows when rider is online and available for deliveries"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }
}
```

## Step 4: DispatchActionReceiver.kt

```kotlin
package app.lovable.35bd9daf0ce94743a361ec2d45be6932.plugins

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class DispatchActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val plugin = RiderServicePlugin.instance ?: return

        when (intent.action) {
            "ACCEPT_DISPATCH" -> {
                val offerId = intent.getStringExtra("offerId") ?: return
                plugin.emitDispatchAction("accept", offerId)
            }
            "REJECT_DISPATCH" -> {
                val offerId = intent.getStringExtra("offerId") ?: return
                plugin.emitDispatchAction("reject", offerId)
            }
            "TOGGLE_OFFLINE" -> {
                plugin.emitToggleOffline()
            }
        }
    }
}
```

## Step 5: FloatingOverlayService.kt (Home Screen Widget)

This creates a draggable floating bubble visible on the phone's home screen (like Facebook Messenger chat heads).

```kotlin
package app.lovable.35bd9daf0ce94743a361ec2d45be6932.plugins

import android.app.Service
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.os.Build
import android.os.IBinder
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

class FloatingOverlayService : Service() {

    private var windowManager: WindowManager? = null
    private var floatingView: View? = null

    // Current data
    private var orderNumber = ""
    private var vendorName = ""
    private var statusLabel = ""
    private var deliveryFee = 0.0
    private var distanceKm = 0.0

    // Views for updating
    private var tvOrder: TextView? = null
    private var tvVendor: TextView? = null
    private var tvStatus: TextView? = null
    private var tvDetails: TextView? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "SHOW" -> {
                orderNumber = intent.getStringExtra("orderNumber") ?: ""
                vendorName = intent.getStringExtra("vendorName") ?: ""
                statusLabel = intent.getStringExtra("statusLabel") ?: ""
                deliveryFee = intent.getDoubleExtra("deliveryFee", 0.0)
                distanceKm = intent.getDoubleExtra("distanceKm", 0.0)

                if (floatingView == null) {
                    createFloatingView()
                }
                updateViewContent()
            }
            "UPDATE" -> {
                intent.getStringExtra("orderNumber")?.let { orderNumber = it }
                intent.getStringExtra("vendorName")?.let { vendorName = it }
                intent.getStringExtra("statusLabel")?.let { statusLabel = it }
                if (intent.hasExtra("deliveryFee")) deliveryFee = intent.getDoubleExtra("deliveryFee", deliveryFee)
                if (intent.hasExtra("distanceKm")) distanceKm = intent.getDoubleExtra("distanceKm", distanceKm)
                updateViewContent()
            }
        }
        return START_STICKY
    }

    private fun createFloatingView() {
        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 20
            y = 200
        }

        // Build the UI programmatically
        val density = resources.displayMetrics.density

        // Outer container with rounded background
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(
                (16 * density).toInt(),
                (12 * density).toInt(),
                (16 * density).toInt(),
                (12 * density).toInt()
            )
            setBackgroundColor(Color.parseColor("#1A1A2E"))
            // Apply rounded corners via a GradientDrawable
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#1A1A2E"))
                cornerRadius = 16 * density
                setStroke((1 * density).toInt(), Color.parseColor("#FF6B35"))
            }
            background = bg
            minimumWidth = (220 * density).toInt()
            elevation = 8 * density
        }

        // Header row: 🏍️ + Order number
        tvOrder = TextView(this).apply {
            setTextColor(Color.parseColor("#FF6B35"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTypeface(null, Typeface.BOLD)
        }
        container.addView(tvOrder)

        // Vendor name
        tvVendor = TextView(this).apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        }
        container.addView(tvVendor, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = (4 * density).toInt() })

        // Status badge
        tvStatus = TextView(this).apply {
            setTextColor(Color.parseColor("#4ADE80"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setTypeface(null, Typeface.BOLD)
        }
        container.addView(tvStatus, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = (4 * density).toInt() })

        // Details line (fee + distance)
        tvDetails = TextView(this).apply {
            setTextColor(Color.parseColor("#9CA3AF"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
        }
        container.addView(tvDetails, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = (2 * density).toInt() })

        floatingView = container

        // Make it draggable
        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f
        var isDragging = false

        container.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    isDragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - initialTouchX
                    val dy = event.rawY - initialTouchY
                    if (dx * dx + dy * dy > 25) isDragging = true
                    params.x = initialX + dx.toInt()
                    params.y = initialY + dy.toInt()
                    windowManager?.updateViewLayout(floatingView, params)
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!isDragging) {
                        // Tap → open app
                        RiderServicePlugin.instance?.emitOverlayTapped()
                        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
                        launchIntent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        startActivity(launchIntent)
                    }
                    true
                }
                else -> false
            }
        }

        windowManager?.addView(floatingView, params)
    }

    private fun updateViewContent() {
        tvOrder?.text = "🏍️ Order #$orderNumber"
        tvVendor?.text = vendorName
        tvStatus?.text = "● ${statusLabel.uppercase()}"
        tvDetails?.text = "₦${deliveryFee.toInt()} • ${String.format("%.1f", distanceKm)}km"
    }

    override fun onDestroy() {
        floatingView?.let { windowManager?.removeView(it) }
        floatingView = null
        super.onDestroy()
    }
}
```

## Step 6: AndroidManifest.xml additions

```xml
<!-- Inside <manifest> -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
<uses-permission android:name="android.permission.VIBRATE" />

<!-- Inside <application> -->
<service
    android:name=".plugins.RiderForegroundService"
    android:foregroundServiceType="specialUse"
    android:exported="false" />

<service
    android:name=".plugins.FloatingOverlayService"
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
5. **Floating overlay** → Web calls `showFloatingOverlay()` → draggable bubble appears on home screen showing order info → tap opens app

## Floating Overlay Usage (from web code)

```typescript
// Show the overlay when rider has an active order
await RiderServicePlugin.showFloatingOverlay({
  orderNumber: "FC-1234",
  vendorName: "Chicken Republic",
  statusLabel: "Picked Up",
  deliveryFee: 1500,
  distanceKm: 3.2,
});

// Update as status changes
await RiderServicePlugin.updateFloatingOverlay({
  statusLabel: "On the Way",
});

// Hide when delivered
await RiderServicePlugin.hideFloatingOverlay();
```
