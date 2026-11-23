import fs from 'node:fs';
const manifest = 'src-tauri/gen/android/app/src/main/AndroidManifest.xml';
if (fs.existsSync(manifest)) {
  let xml = fs.readFileSync(manifest, 'utf8');
  if (!xml.includes('android:usesCleartextTraffic=')) xml = xml.replace('<application', '<application android:usesCleartextTraffic="true"');
  else xml = xml.replace(/android:usesCleartextTraffic="[^"]*"/, 'android:usesCleartextTraffic="true"');
  xml = xml.replace(/android:label="[^"]*"/, 'android:label="阅读"');
  fs.writeFileSync(manifest, xml);
}
const gradle = 'src-tauri/gen/android/app/build.gradle.kts';
if (fs.existsSync(gradle)) {
  let text = fs.readFileSync(gradle, 'utf8');
  text = text.replace(/compileSdk\s*=\s*\d+/, 'compileSdk = 36').replace(/targetSdk\s*=\s*\d+/, 'targetSdk = 36');
  if (!text.includes('LEGADO_RELEASE_SIGNING')) {
    text = text.replace('    buildTypes {', `    // LEGADO_RELEASE_SIGNING
    val releaseStore = System.getenv("ANDROID_KEYSTORE_PATH")
    if (!releaseStore.isNullOrBlank()) {
        signingConfigs.create("release") {
            storeFile = file(releaseStore)
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes {`);
    text = text.replace('getByName("release") {', `getByName("release") {
            if (!releaseStore.isNullOrBlank()) signingConfig = signingConfigs.getByName("release")`);
  }
  fs.writeFileSync(gradle, text);
}
const activity = 'src-tauri/gen/android/app/src/main/java/com/suixincrazy/legado/MainActivity.kt';
if (fs.existsSync(activity)) fs.copyFileSync('mobile/android/MainActivity.kt', activity);
const strings = 'src-tauri/gen/android/app/src/main/res/values/strings.xml';
if (fs.existsSync(strings)) fs.writeFileSync(strings, fs.readFileSync(strings, 'utf8').replace(/"Legado Reader"/g, '阅读'));
