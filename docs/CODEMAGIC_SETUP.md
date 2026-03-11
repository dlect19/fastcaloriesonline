# Codemagic CI/CD Setup Guide

## Overview

This guide walks you through setting up Codemagic to build and deploy your FastCalories mobile apps for iOS and Android.

## Prerequisites

- **Git Repository**: Your code should be in a Git repository (GitHub, GitLab, or Bitbucket)
- **Codemagic Account**: Sign up at [codemagic.io](https://codemagic.io)
- **Android Keystore**: For release builds (see Android section)
- **Apple Developer Account**: For iOS builds ($99/year)

## Step 1: Connect Repository to Codemagic

1. Log in to [Codemagic](https://codemagic.io)
2. Click **"Add application"**
3. Select your Git provider (GitHub/GitLab/Bitbucket)
4. Authorize Codemagic to access your repositories
5. Select the `fastcaloriesonline` repository
6. Choose **"Capacitor"** as the project type
7. Complete the setup wizard

## Step 2: Configure Android Release Builds

### Generate Keystore (if you don't have one)

```bash
# Generate a new keystore
keytool -genkey -v -keystore fastcalories-release.keystore -alias fastcalories -keyalg RSA -keysize 2048 -validity 10000

# You'll be prompted for:
# - Keystore password (remember this!)
# - Key password (remember this!)
# - Your name, organization, etc.
```

### Upload Keystore to Codemagic

1. In Codemagic, go to your app settings
2. Navigate to **"Environment variables"** tab
3. Click **"Add group"**
4. Name it `keystore_credentials`
5. Add the following variables:

| Variable Name | Type | Value |
|--------------|------|-------|
| `CM_KEYSTORE` | File | Upload your `.keystore` file (will be base64 encoded) |
| `CM_KEYSTORE_PATH` | Secret | `/tmp/keystore.keystore` |
| `CM_KEY_ALIAS` | Secret | Your keystore alias (e.g., `fastcalories`) |
| `CM_KEYSTORE_PASSWORD` | Secret | Your keystore password |
| `CM_KEY_PASSWORD` | Secret | Your key password |

### Update Android build.gradle (if needed)

The `android/app/build.gradle` should include signing config for release:

```gradle
android {
    signingConfigs {
        release {
            if (System.getenv('CM_KEYSTORE_PATH')) {
                storeFile file(System.getenv('CM_KEYSTORE_PATH'))
                storePassword System.getenv('CM_KEYSTORE_PASSWORD')
                keyAlias System.getenv('CM_KEY_ALIAS')
                keyPassword System.getenv('CM_KEY_PASSWORD')
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

## Step 3: Configure iOS Release Builds

### Apple Developer Account Setup

1. Ensure you have an **Apple Developer account** ($99/year)
2. Create an **App ID** in the Apple Developer Portal:
   - Identifier: `com.fastcalories.customer`
   - Name: "Fast Calories"
3. Enable required capabilities:
   - Push Notifications
   - Background Modes

### Connect Apple Developer in Codemagic

1. In Codemagic, go to **Teams** → **Integrations**
2. Click **"Enable"** for Apple Developer Portal
3. Click **"Connect"**
4. Sign in with your Apple Developer account
5. Complete 2FA authentication

**Note**: Your project uses **Swift Package Manager (SPM)** for dependency management, not CocoaPods. Capacitor 8+ projects use SPM by default.

### Create Environment Group

1. Go to your app's **Environment variables**
2. Create a group named `ios_credentials`
3. Add your Apple Developer credentials if manual setup is needed
4. Codemagic will automatically handle code signing via API

## Step 4: Environment Variables for the App

Add any environment variables your app needs:

1. Go to **Environment variables**
2. Create a group named `app_config` (or add to existing)
3. Add variables from your `.env` file:

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_key
VITE_FIREBASE_API_KEY=your_firebase_key
# ... other variables
```

## Step 5: Trigger Your First Build

### Option 1: Manual Trigger

1. Go to your app in Codemagic
2. Click **"Start new build"**
3. Select workflow:
   - `android-debug` - For testing
   - `android-release` - For production APK
   - `ios-debug` - For iOS testing
   - `ios-release` - For App Store
4. Click **"Start new build"**

### Option 2: Automatic Triggers

Configure in `codemagic.yaml`:

```yaml
workflows:
  android-release:
    triggering:
      events:
        - push
      branch_patterns:
        - pattern: 'main'
          include: true
      tag_patterns:
        - pattern: 'v*'
          include: true
```

## Available Workflows

Your project has 4 pre-configured workflows in `codemagic.yaml`:

### 1. `android-debug`
- **Purpose**: Quick testing builds
- **Output**: Debug APK
- **Use**: Testing on devices
- **Signing**: No signing required

### 2. `android-release`
- **Purpose**: Production builds
- **Output**: Signed release APK
- **Use**: Distribution (Google Play, direct download)
- **Signing**: Requires keystore credentials

### 3. `ios-debug`
- **Purpose**: iOS simulator/device testing
- **Output**: .app file
- **Use**: Local testing
- **Signing**: No signing required

### 4. `ios-release`
- **Purpose**: App Store submission
- **Output**: .ipa file
- **Use**: TestFlight, App Store
- **Signing**: Requires Apple Developer account

## Build Artifacts

After successful builds, artifacts are available:

- **Android Debug**: `android/app/build/outputs/apk/debug/app-debug.apk`
- **Android Release**: `android/app/build/outputs/apk/release/app-release.apk`
- **iOS Release**: `ios/App/build/ios/ipa/*.ipa`

They'll be emailed to: `dlect19@gmail.com` (configured in `codemagic.yaml`)

## Local Development Scripts

Use these npm scripts for local development:

```bash
# Sync web assets to native projects
npm run cap:sync

# Open native IDEs
npm run cap:open:android     # Opens Android Studio
npm run cap:open:ios         # Opens Xcode (Mac only)

# Run on connected devices
npm run cap:run:android
npm run cap:run:ios

# Build Android locally
npm run android:build        # Debug
npm run android:release      # Release
```

**Note**: iOS dependencies are managed via Swift Package Manager (SPM). When you open the project in Xcode, it will automatically resolve SPM dependencies.

## Troubleshooting

### Build fails at "Install dependencies"
- Check that `package.json` is valid
- Ensure all dependencies are properly declared

### Build fails at "Build web assets"
- Check for TypeScript errors: `npm run lint`
- Test build locally: `npm run build`

### Android build fails at signing
- Verify keystore credentials are correct
- Ensure `CM_KEYSTORE_PATH` points to `/tmp/keystore.keystore`
- Check that the keystore alias matches

### iOS build fails at code signing
- Verify Apple Developer account is connected
- Check that Bundle ID `com.fastcalories.customer` is registered
- Ensure certificates are not expired

### "dist directory not found"
- Ensure `npm run build` completes successfully
- Check that `webDir: 'dist'` in `capacitor.config.ts` is correct

### iOS build fails: 'App.xcworkspace' does not exist
- **Your project uses Swift Package Manager (SPM), not CocoaPods**
- Capacitor 8+ uses SPM by default, which doesn't create a workspace file
- **Solution**: The updated `codemagic.yaml` now uses `-project App.xcodeproj` instead of `-workspace`
- Ensure the build command uses `xcodebuild -project App.xcodeproj -scheme App`
- Swift dependencies are resolved with `xcodebuild -resolvePackageDependencies`

### iOS pod install fails
- **Not applicable**: Your project uses Swift Package Manager, not CocoaPods
- No Podfile exists in this project
- Dependencies are managed via `Package.swift` in `ios/App/CapApp-SPM/`
- If you see CocoaPods errors, remove `cocoapods: default` from the environment

## Publishing

### Google Play Store

1. Build release APK using `android-release` workflow
2. Go to [Google Play Console](https://play.google.com/console)
3. Create a new app (if first time)
4. Upload the APK to Internal Testing → Production
5. Complete store listing, screenshots, etc.
6. Submit for review

### Apple App Store

1. Build release IPA using `ios-release` workflow
2. Download the .ipa file
3. Upload to App Store Connect using Transporter app
4. Complete App Store listing in App Store Connect
5. Submit for review

## Advanced: Bundle Native Assets

To create a standalone app (not loading from `server.url`):

1. Edit `capacitor.config.ts`:
   ```typescript
   const config: CapacitorConfig = {
     appId: 'com.fastcalories.customer',
     appName: 'Fast Calories',
     webDir: 'dist',
     // Remove or comment out the server config:
     // server: { ... }
   };
   ```

2. Rebuild:
   ```bash
   npm run cap:sync
   ```

This bundles your web assets into the app instead of loading from the remote URL.

## Support

- **Codemagic Docs**: https://docs.codemagic.io/
- **Capacitor Docs**: https://capacitorjs.com/docs
- **Community**: Codemagic Slack channel

## Checklist

- [ ] Repository connected to Codemagic
- [ ] Android keystore generated and uploaded
- [ ] iOS credentials configured
- [ ] Environment variables added
- [ ] First successful debug build completed
- [ ] First successful release build completed
- [ ] Artifacts downloaded and tested
- [ ] App submitted to stores

---

**Last Updated**: March 11, 2026
