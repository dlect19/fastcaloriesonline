# iOS Build Fix - Swift Package Manager

## Issue
Your Codemagic iOS build was failing with:
```
xcodebuild: error: 'App.xcworkspace' does not exist.
```

## Root Cause
**Capacitor 8+ uses Swift Package Manager (SPM), not CocoaPods.**

- No `Podfile` exists (SPM doesn't need one)
- No `App.xcworkspace` is generated (SPM projects use `.xcodeproj`)
- Dependencies are managed via `Package.swift` instead

## What Was Fixed

### 1. Updated `codemagic.yaml` iOS Workflows

**Before** (incorrect):
```yaml
- name: Install CocoaPods dependencies
  script: |
    cd ios/App
    pod install
    
- name: Build iOS
  script: |
    cd ios/App
    xcodebuild build \
      -workspace App.xcworkspace \  # ❌ Doesn't exist
```

**After** (correct):
```yaml
- name: Resolve Swift Package Manager dependencies
  script: |
    cd ios/App
    xcodebuild -resolvePackageDependencies -project App.xcodeproj -scheme App
    
- name: Build iOS
  script: |
    cd ios/App
    xcodebuild build \
      -project App.xcodeproj \  # ✅ Uses .xcodeproj
```

### 2. Key Changes

1. **Removed** `cocoapods: default` from environment
2. **Removed** `pod install` step
3. **Added** SPM dependency resolution step
4. **Changed** from `-workspace App.xcworkspace` to `-project App.xcodeproj`

### 3. Both Workflows Updated

- ✅ `ios-debug` - Now uses `.xcodeproj`
- ✅ `ios-release` - Now uses `.xcodeproj`

## How Swift Package Manager Works

### Dependency File
```
ios/App/CapApp-SPM/Package.swift
```

This file lists all Capacitor plugins:
- @capacitor-firebase/messaging
- @capacitor/app
- @capacitor/geolocation
- @capacitor/push-notifications

### Dependency Resolution

Xcode automatically resolves SPM dependencies when you:
1. Open the project in Xcode
2. Run `xcodebuild -resolvePackageDependencies`
3. Build the project

### No Separate Files Needed

Unlike CocoaPods:
- ❌ No `Podfile`
- ❌ No `Podfile.lock`
- ❌ No `Pods/` folder
- ❌ No `.xcworkspace` (usually)

## Testing the Fix

### Run on Codemagic

1. Commit and push your changes:
   ```bash
   git add codemagic.yaml docs/
   git commit -m "Fix iOS build: Use SPM instead of CocoaPods"
   git push
   ```

2. Trigger `ios-debug` workflow in Codemagic

3. Expected output:
   ```
   ✓ Sync Capacitor
   ✓ Resolve Swift Package Manager dependencies
   ✓ Build iOS
   ```

### Build Locally (Mac)

```bash
# Sync Capacitor
npm run cap:sync:ios

# Resolve SPM dependencies
cd ios/App
xcodebuild -resolvePackageDependencies -project App.xcodeproj -scheme App

# Build
xcodebuild build \
  -project App.xcodeproj \
  -scheme App \
  -sdk iphonesimulator \
  -configuration Debug
```

Or simply:
```bash
npm run cap:open:ios
# Xcode will resolve dependencies automatically
```

## Understanding the Build Command

### Debug Build (Simulator)
```bash
xcodebuild build \
  -project App.xcodeproj \          # Use .xcodeproj, not .xcworkspace
  -scheme App \                      # Your app scheme
  -sdk iphonesimulator \             # Simulator SDK
  -configuration Debug \             # Debug configuration
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO            # No signing for debug
```

### Release Build (Physical Device/App Store)
```bash
xcode-project build-ipa \
  --project App.xcodeproj \          # Use .xcodeproj
  --scheme App
```

## Migration from CocoaPods to SPM

If you had previously used CocoaPods and migrated to Capacitor 8+:

### Remove (if present):
```bash
# From your project
rm -rf ios/App/Podfile
rm -rf ios/App/Podfile.lock
rm -rf ios/App/Pods/
rm -rf ios/App/*.xcworkspace
```

### Keep:
```
ios/App/App.xcodeproj          # Xcode project
ios/App/CapApp-SPM/            # SPM package definition
```

## Capacitor CLI Behavior

When you run `npx cap sync ios`:
1. Copies web assets to `ios/App/App/public/`
2. Updates `Package.swift` with installed plugins
3. Updates Xcode project configuration
4. **Does NOT** run pod install (SPM handles it)

## When Dependencies Are Resolved

Swift Package Manager resolves dependencies:
- ✅ When Xcode opens the project
- ✅ When you run `xcodebuild -resolvePackageDependencies`
- ✅ First time building the project
- ✅ When adding new Capacitor plugins

## Troubleshooting

### "Package.swift not found"
Check that `ios/App/CapApp-SPM/Package.swift` exists:
```bash
ls -la ios/App/CapApp-SPM/
```

### "Could not resolve package dependencies"
Clear SPM cache and retry:
```bash
rm -rf ~/Library/Developer/Xcode/DerivedData/*
cd ios/App
xcodebuild -resolvePackageDependencies -project App.xcodeproj -scheme App
```

### "Module not found" errors
Ensure all Capacitor plugins are:
1. Listed in `package.json`
2. Installed via `npm install`
3. Registered in `Package.swift` (done by `cap sync`)

## Additional Resources

- [Capacitor iOS Documentation](https://capacitorjs.com/docs/ios)
- [Swift Package Manager Guide](https://www.swift.org/package-manager/)
- [Capacitor 6+ Migration](https://capacitorjs.com/docs/updating/6-0#migrating-to-spm) (SPM introduced)

## Summary

✅ **Your iOS builds now use Swift Package Manager (SPM)**
✅ **No CocoaPods installation needed**
✅ **Build commands updated to use `.xcodeproj`**
✅ **Both debug and release workflows fixed**

## Appetize And Simulator Note

If the `ios-debug` build crashes immediately on Appetize or another iOS simulator with a Firebase error like:

```text
Could not locate configuration file: 'GoogleService-Info.plist'
FirebaseApp.configure() could not find a valid GoogleService-Info.plist
```

that means the native Firebase Messaging plugin is loading during app startup, but the iOS Firebase config file has not been added yet.

For this project, the `ios-debug` Codemagic workflow removes `FirebaseMessagingPlugin` from the generated Capacitor iOS plugin list before the simulator build. This allows the app to launch on Appetize for UI testing without requiring Firebase iOS setup.

Important:

- `ios-debug` is intended for simulator and Appetize testing
- push notification features that depend on Firebase Messaging will not work in that debug simulator build
- `ios-release` is unchanged and should still use the full native plugin set once proper iOS Firebase configuration is added

Your next Codemagic build should succeed! 🎉

## Appetize And Simulator Note

If the `ios-debug` build crashes immediately on Appetize or another iOS simulator with a Firebase error like:

```text
Could not locate configuration file: 'GoogleService-Info.plist'
FirebaseApp.configure() could not find a valid GoogleService-Info.plist
```

that means the native Firebase Messaging plugin is loading during app startup, but the iOS Firebase config file has not been added yet.

For this project, the `ios-debug` Codemagic workflow now removes `FirebaseMessagingPlugin` from the generated Capacitor iOS plugin list before the simulator build. This allows the app to launch on Appetize for UI testing without requiring Firebase iOS setup.

Important:

- `ios-debug` is now intended for simulator and Appetize testing
- push notification features that depend on Firebase Messaging will not work in that debug simulator build
- `ios-release` is unchanged and should still use the full native plugin set once proper iOS Firebase configuration is added

Your next Codemagic build should succeed! 🎉

---

**Fixed on**: March 11, 2026
