# Fin Buddy on Android and iOS

The Capacitor projects bundle the responsive UI, an IndexedDB ledger and the small SmolLM2-135M-Instruct ONNX model. They do not use the desktop server or an internet API for finance processing. Each installed app has its own profiles and data; it does not synchronize with the desktop ledger.

## Build

From the repository root:

```powershell
npm ci
npm run mobile:model
npm run mobile:android
# On a Mac with Xcode:
npm run mobile:ios
```

The model downloader fetches public model files from Hugging Face and records the resolved revision in `BUNDLE-METADATA.json`. It never uploads statement content. The model payload is approximately 185 MB before packaging; the full uncompressed bundle with local PDF/OCR readers is approximately 352 MB. Installer compression reduces the download size; use the actual release asset size for the final APK. Downloaded weights, compiled assets, signing keys and financial data are excluded from Git. Both platform projects are generated locally.

Android requires JDK 21 and Android SDK 36. Open `mobile/android` in Android Studio or run its Gradle wrapper with `assembleDebug` for a test APK. Google Play distribution requires a signed release AAB, a developer account, and release review. The current application identifier `io.finbuddy.app` must be checked/changed before store submission.

iOS requires a Mac with compatible Xcode. Open `mobile/ios/App/App.xcodeproj`, select a development team, configure signing, and archive for App Store Connect. Simulator builds do not require distribution signing and cannot be installed on a real iPhone. Android installation uses the separately signed release APK attached to the GitHub release. The signing key is stored outside the repository in the Windows user profile with a DPAPI-protected password. iOS simulator builds are verified separately; real-device signing and App Store submission require your Apple Developer account.

`.github/workflows/native-build.yml` is a manual-only workflow for Android debug and iOS simulator artifacts. It is run for release validation. GitHub-hosted build usage may be charged after account allowances.

## On-device features and limits

- Bank exports (CSV, TSV, JSON, OFX/QFX and QIF), PDF, Excel/XLS/ODS, HTML/XML/Word tables and common document images are read locally. Scanned PDFs and images use bundled English OCR. Unreadable, encrypted or unvalidated layouts become document tasks; arbitrary files are not guaranteed to yield transactions.
- Local categorization, comma rules, profiles, merchant suggestions, exact splits and monthly reporting.
- Profile icon → Settings opens On-device AI. It runs up to five unresolved merchant groups at a time. A small model's output is a suggestion requiring confirmation, never evidence of a payment's purpose.
- Model assets and runtime are bundled, with remote model access disabled. No cloud model fallback is enabled. No model hosting is promised to be free.
- Statement sources supports multiple folders through Android's document-tree picker and iOS's security-scoped folder bookmarks. Refresh scans ordinary subfolders recursively. Source grants can expire; select a folder again if its provider becomes unavailable. Scanning is foreground/manual, not a perpetual background watcher. Scans stop at 1,000 files / 40 nested levels; individual document reading is limited to 50 MB / 100 PDF pages.
- Device data persists between app launches in the app's web storage. Uninstalling or clearing app data removes it. Encrypted workspace backup and restore are in Settings. Backups include profiles, transactions and rules but exclude original statement files and model weights. Restore creates new profiles, preserving existing ones. Android automatic backup is disabled and iOS web storage is excluded from automatic cloud backups. The app still relies on the device lock for access control; profiles are not separate authenticated users.
- Monthly reports generate a local PDF and open the native save/share sheet. In the browser the PDF downloads directly. No financial data is sent to an app server for export.
- The standalone web bundle can cache its UI and reader/model assets using Settings → Prepare offline web app. Financial data stays in IndexedDB; financial API responses are not service-worker cached.

## Browser preview

```powershell
npm run mobile:build
node mobile/preview.mjs
```

Open `http://127.0.0.1:3211`. This preview uses an isolated device-local ledger and synthetic test data, not the desktop financial ledger. A browser preview verifies UI and runtime behavior; it does not replace Android/iOS device testing.
