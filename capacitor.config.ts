import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fastcalories.customer',
  appName: 'Fast Calories',
  webDir: 'dist',
  // For production apps, comment out or remove the server config to use bundled assets
  // Currently configured for live reload during development
  server: {
    url: 'https://app.fastcalories.online',
    cleartext: false
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['alert', 'sound', 'badge']
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#ffffff',
      showSpinner: false
    }
  },
  ios: {
    contentInset: 'always'
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false
  }
};

export default config;
