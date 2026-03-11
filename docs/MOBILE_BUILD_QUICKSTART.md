# Mobile Build Quick Start Guide

## ✅ What's Done

Your FastCalories project is now fully configured for iOS and Android builds:

- ✅ iOS platform added
- ✅ Android platform configured with signing
- ✅ Capacitor configuration optimized
- ✅ Helpful npm scripts added
- ✅ Codemagic workflows ready

## 🚀 Quick Commands

```bash
# Build and sync all platforms
npm run cap:sync

# Build and sync specific platform
npm run cap:sync:android
npm run cap:sync:ios

# Open native IDE
npm run cap:open:android    # Opens Android Studio
npm run cap:open:ios        # Opens Xcode (Mac only)

# Run on device/emulator
npm run cap:run:android
npm run cap:run:ios

# Build Android locally
npm run android:build       # Debug APK
npm run android:release     # Release APK (needs signing)
```

## 📱 Test on Device Locally

### Android
1. Enable USB Debugging on your Android device
2. Connect via USB
3. Run: `npm run cap:run:android`

### iOS (Mac only)
1. Connect iPhone via USB
2. Run: `npm run cap:run:ios`
3. Trust developer in iPhone Settings if needed

## ☁️ Build with Codemagic

### First Time Setup (30 minutes)

1. **Connect Repository** 
   - Go to [codemagic.io](https://codemagic.io)
   - Add your Git repository
   - Select "Capacitor" project type

2. **Android Release Setup**
   ```bash
   # Generate keystore (if you don't have one)
   keytool -genkey -v -keystore fastcalories-release.keystore \
     -alias fastcalories -keyalg RSA -keysize 2048 -validity 10000
   ```
   - Upload keystore to Codemagic
   - Create environment group: `keystore_credentials`
   - Add variables:
     - `CM_KEYSTORE` (file)
     - `CM_KEYSTORE_PATH` = `/tmp/keystore.keystore`
     - `CM_KEY_ALIAS` = your alias
     - `CM_KEYSTORE_PASSWORD` = your password
     - `CM_KEY_PASSWORD` = your key password

3. **iOS Release Setup**
   - Connect Apple Developer account in Codemagic
   - Create App ID: `com.fastcalories.customer` in Apple Developer Portal
   - Codemagic handles code signing automatically

4. **Trigger Build**
   - Select workflow: `android-debug`, `android-release`, `ios-debug`, or `ios-release`
   - Click "Start new build"
   - Download artifacts when complete

## 📦 Available Workflows

| Workflow | Platform | Type | Use Case |
|----------|----------|------|----------|
| `android-debug` | Android | Debug | Quick testing |
| `android-release` | Android | Release | Production/Store |
| `ios-debug` | iOS | Debug | Simulator testing |
| `ios-release` | iOS | Release | App Store |

## 🔧 Important Configuration

### Capacitor Server URL

Your `capacitor.config.ts` currently loads content from:
```typescript
server: {
  url: 'https://app.fastcalories.online',
  cleartext: false
}
```

**What this means:**
- ✅ Fast updates (just deploy web, no app update needed)
- ✅ Always latest version
- ⚠️ Requires internet connection
- ⚠️ App Store may question if you're just wrapping a website

**To bundle assets in the app:**
```typescript
// Comment out or remove the server config:
const config: CapacitorConfig = {
  appId: 'com.fastcalories.customer',
  appName: 'Fast Calories',
  webDir: 'dist',
  // server: { ... }  ← Remove this
};
```

Then rebuild: `npm run cap:sync`

## 🎯 Next Steps

1. **Test locally**: `npm run cap:run:android`
2. **Build on Codemagic**: Test `android-debug` workflow
3. **Setup signing**: Configure keystore for release builds
4. **Distribution**: 
   - Android: Google Play Console
   - iOS: App Store Connect

## 📖 Full Documentation

- [CODEMAGIC_SETUP.md](./CODEMAGIC_SETUP.md) - Complete setup guide
- [Capacitor Docs](https://capacitorjs.com/docs)
- [Codemagic Docs](https://docs.codemagic.io/)

## ⚙️ Project Info

- **App ID**: `com.fastcalories.customer`
- **App Name**: Fast Calories
- **Min Android**: API 23 (Android 6.0)
- **Target Android**: API 35 (Android 15)
- **iOS Target**: Latest
- **Capacitor**: v8.0.2

## 🆘 Common Issues

**"dist directory not found"**
→ Run `npm run build` first

**"No connected devices"**
→ Enable USB debugging (Android) or trust computer (iOS)

**"Build failed at signing"**
→ Check keystore credentials in Codemagic

**"Module not found" build errors**
→ Delete `node_modules` and run `npm install`

---

Need help? Check the full [CODEMAGIC_SETUP.md](./CODEMAGIC_SETUP.md) guide.
