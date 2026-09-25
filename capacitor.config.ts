import type { CapacitorConfig } from '@capacitor/cli';
import { readFileSync } from 'node:fs';

// Native plugins that must never be linked on iOS. @capacitor/inappbrowser pulls in
// OSInAppBrowserLib (SwiftUI) which strongly links SwiftUICore and crashes iOS 15/16
// at launch. Android keeps it (in-app Paystack checkout); iOS uses @capacitor/browser.
const IOS_EXCLUDED_PLUGINS = ['@capacitor/inappbrowser'];
const NON_PLUGIN_PACKAGES = ['@capacitor/core', '@capacitor/cli', '@capacitor/android', '@capacitor/ios', '@capacitor/assets'];
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const allPlugins = Object.keys({ ...pkg.dependencies }).filter(
  (n) => /^@capacitor(-firebase)?\//.test(n) && !NON_PLUGIN_PACKAGES.includes(n),
);
export const iosPlugins = allPlugins.filter((n) => !IOS_EXCLUDED_PLUGINS.includes(n));

const serverUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.customers.fastcalories.app',
  appName: 'Fast Calories',
  webDir: 'dist',
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: serverUrl.startsWith('http://'),
        },
      }
    : {}),
  plugins: {
    PushNotifications: {
      presentationOptions: ['alert', 'sound', 'badge']
    },
    SplashScreen: {
      launchAutoHide: false,
      launchShowDuration: 0,
      backgroundColor: '#f0fdf4',
      showSpinner: false
    }
  },
  ios: {
    contentInset: 'always',
    includePlugins: iosPlugins
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false
  }
};

export default config;
