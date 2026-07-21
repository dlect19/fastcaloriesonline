package com.customers.fastcalories.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ReminderPlugin")
public class ReminderPlugin extends Plugin {
    @PluginMethod
    public void scheduleReminder(PluginCall call) {
        String title = call.getString("title", "Medication Reminder");
        String message = call.getString("message", "It's time to take your medication.");
        Long triggerTime = call.getLong("triggerTime");

        if (triggerTime == null || triggerTime <= System.currentTimeMillis()) {
            call.reject("triggerTime must be a future timestamp in milliseconds");
            return;
        }

        try {
            ReminderScheduler.schedule(getContext(), title, message, triggerTime, true);
            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Failed to schedule reminder", error);
        }
    }
}