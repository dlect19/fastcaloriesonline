/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

// Web Push API type augmentation
interface PushSubscriptionOptionsInit {
  userVisibleOnly?: boolean;
  applicationServerKey?: ArrayBuffer | ArrayBufferView | string | null;
}

interface PushSubscription {
  readonly endpoint: string;
  readonly options: PushSubscriptionOptionsInit;
  getKey(name: string): ArrayBuffer | null;
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
}

interface PushManager {
  getSubscription(): Promise<PushSubscription | null>;
  subscribe(options?: PushSubscriptionOptionsInit): Promise<PushSubscription>;
  permissionState(options?: PushSubscriptionOptionsInit): Promise<string>;
}

interface ServiceWorkerRegistration {
  readonly pushManager: PushManager;
}
