import type { CapacitorConfig } from '@capacitor/cli';
import { readFileSync } from 'fs';
import { join } from 'path';

// Native plugins that must never be linked on iOS. @capacitor/inappbrowser pulls in
// OSInAppBrowserLib (SwiftUI) which strongly links SwiftUICore and crashes iOS 15/16
// at launch. Android keeps it (in-app Paystack checkout); iOS uses @capacitor/browser.
const IOS_EXCLUDED_PLUGINS = ['@capacitor/inappbrowser'];
const NON_PLUGIN_PACKAGES = ['@capacitor/core', '@capacitor/cli', '@capacitor/android', '@capacitor/ios', '@capacitor/assets'];
const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
const allPlugins = Object.keys({ ...pkg.dependencies }).filter(
  (n) => /^@capacitor(-firebase)?\//.test(n) && !NON_PLUGIN_PACKAGES.includes(n),
);
export const iosPlugins = allPlugins.filter((n) => !IOS_EXCLUDED_PLUGINS.includes(n));

const serverUrl = process.env.CAP_SERVER_URL;

// Build target. Absent/anything else = customer (unchanged). CAP_APP_VARIANT=rider
// points Capacitor at the isolated rider native project and rider web output, so a
// rider sync can never write into android/ or dist/.
export const capVariant = process.env.CAP_APP_VARIANT === 'rider' ? 'rider' : 'customer';
const isRider = capVariant === 'rider';

const config: CapacitorConfig = {
  appId: isRider ? 'com.rider.fastcalories.app' : 'com.customers.fastcalories.app',
  appName: isRider ? 'FastCalories Rider' : 'Fast Calories',
  webDir: isRider ? 'dist-rider' : 'dist',
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: serverUrl.startsWith('http://'),
        },
      }
    : {}),
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_fastcalories',
      iconColor: '#FF6B35'
    },
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
    ...(isRider ? { path: 'ios-rider' } : {}),
    contentInset: 'always',
    includePlugins: iosPlugins
  },
  android: {
    ...(isRider ? { path: 'android-rider' } : {}),
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false
  }
};

export default config;
