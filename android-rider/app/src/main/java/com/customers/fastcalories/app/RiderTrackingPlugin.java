package com.customers.fastcalories.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONObject;

/**
 * JS bridge for RiderTrackingService. start() must be called while the app is visible
 * (Android only allows a location foreground service to start from the foreground). JS
 * passes server-issued per-delivery tracking tokens; the rider's session tokens never
 * reach native code. Calling start() again replaces the delivery set — one service only.
 */
@CapacitorPlugin(
    name = "RiderTracking",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" })
    }
)
public class RiderTrackingPlugin extends Plugin {

    private boolean hasLocation() {
        Context c = getContext();
        return ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!hasLocation()) { call.reject("Location permission not granted", "permission_denied"); return; }
        String url = call.getString("supabaseUrl"), anon = call.getString("anonKey");
        Long expires = call.getLong("expiresAt");
        JSArray list = call.getArray("orders");
        if (url == null || anon == null || expires == null || list == null || list.length() == 0) {
            call.reject("Missing tracking parameters", "invalid_arguments"); return;
        }
        JSONObject orders = new JSONObject();
        try {
            for (int i = 0; i < list.length(); i++) {
                JSONObject o = list.getJSONObject(i);
                String id = o.getString("orderId"), token = o.getString("token");
                if (token.length() != 64) { call.reject("Invalid tracking token", "invalid_arguments"); return; }
                orders.put(id, token);
            }
        } catch (Exception e) { call.reject("Invalid orders", "invalid_arguments"); return; }
        getContext().getSharedPreferences(RiderTrackingService.PREFS, Context.MODE_PRIVATE).edit()
            .putString("url", url).putString("anon", anon).putLong("expires_at", expires)
            .putString("orders", orders.toString()).apply();
        Intent i = new Intent(getContext(), RiderTrackingService.class).setAction(RiderTrackingService.ACTION_START);
        try {
            ContextCompat.startForegroundService(getContext(), i);
        } catch (Exception e) {
            call.reject("Could not start location sharing service", "foreground_start_refused"); return;
        }
        JSObject r = new JSObject(); r.put("started", true); call.resolve(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context c = getContext();
        c.getSharedPreferences(RiderTrackingService.PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        if (RiderTrackingService.running) {
            Intent i = new Intent(c, RiderTrackingService.class).setAction(RiderTrackingService.ACTION_STOP);
            try { c.startService(i); } catch (Exception e) { c.stopService(new Intent(c, RiderTrackingService.class)); }
        }
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("running", RiderTrackingService.running);
        r.put("activeOrders", RiderTrackingService.activeOrders);
        r.put("lastUploadAt", RiderTrackingService.lastUploadAt);
        r.put("acceptedCount", RiderTrackingService.acceptedCount);
        r.put("lastError", RiderTrackingService.lastError);
        r.put("locationGranted", hasLocation());
        call.resolve(r);
    }
}
