import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fastcalories.customer',
  appName: 'Fast Calories',
  webDir: 'dist',
  server: {
    url: 'https://app.fastcalories.online',
    cleartext: false
  }
};

export default config;
