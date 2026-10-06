import { Capacitor } from '@capacitor/core';

export function isNativeIosSpin(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

export function isSpinAllowedOnPlatform(wheelType: string): boolean {
  return wheelType === 'free' || !isNativeIosSpin();
}