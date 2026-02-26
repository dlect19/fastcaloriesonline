import { registerPlugin } from '@capacitor/core';

export interface AppUpdatePlugin {
  downloadAndInstall(options: { url: string }): Promise<void>;
}

const AppUpdate = registerPlugin<AppUpdatePlugin>('AppUpdate');

export default AppUpdate;
