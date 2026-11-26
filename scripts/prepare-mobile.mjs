import fs from 'node:fs';
// Maven Central's Google mirror also serves Kotlin's transitive plugin dependencies.
const mirror = 'maven { url = uri("https://maven-central.storage-download.googleapis.com/maven2") }';
for (const file of ['src-tauri/gen/android/build.gradle.kts', 'src-tauri/gen/android/buildSrc/build.gradle.kts']) {
  if (!fs.existsSync(file)) continue;
  let text = fs.readFileSync(file, 'utf8');
  if (!text.includes('maven-central.storage-download')) text = text.replace(/repositories\s*\{/g, `repositories {\n    ${mirror}`);
  fs.writeFileSync(file, text);
}
const buildSrcSettings = 'src-tauri/gen/android/buildSrc/settings.gradle.kts';
if (fs.existsSync('src-tauri/gen/android/buildSrc') && !fs.existsSync(buildSrcSettings)) fs.writeFileSync(buildSrcSettings, `pluginManagement { repositories { ${mirror}; gradlePluginPortal(); google() } }\n`);
const manifest = 'src-tauri/gen/android/app/src/main/AndroidManifest.xml';
if (fs.existsSync(manifest)) {
  let xml = fs.readFileSync(manifest, 'utf8');
  if (!xml.includes('android:usesCleartextTraffic=')) xml = xml.replace('<application', '<application android:usesCleartextTraffic="true"');
  else xml = xml.replace(/android:usesCleartextTraffic="[^"]*"/, 'android:usesCleartextTraffic="true"');
  xml = xml.replace(/android:label="[^"]*"/, 'android:label="阅读"');
  for (const permission of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'WAKE_LOCK', 'CAMERA']) {
    if (!xml.includes(`android.permission.${permission}"`)) xml = xml.replace('<application', `<uses-permission android:name="android.permission.${permission}"/><application`);
  }
  if (!xml.includes('android.intent.action.TTS_SERVICE')) xml = xml.replace('<application', '<queries><intent><action android:name="android.intent.action.TTS_SERVICE"/></intent></queries><application');
  if (!xml.includes('.ReadAloudService')) xml = xml.replace('</application>', '<service android:name=".ReadAloudService" android:exported="false" android:foregroundServiceType="mediaPlayback"/></application>');
  if (!xml.includes('.QrScannerActivity')) xml = xml.replace('</application>', '<activity android:name=".QrScannerActivity" android:exported="false"/></application>');
  if (!xml.includes('android.hardware.camera.any')) xml = xml.replace('<application', '<uses-feature android:name="android.hardware.camera.any" android:required="false"/><application');
  fs.writeFileSync(manifest, xml);
}
const gradle = 'src-tauri/gen/android/app/build.gradle.kts';
if (fs.existsSync(gradle)) {
  let text = fs.readFileSync(gradle, 'utf8');
  if (!text.includes('androidx.constraintlayout:constraintlayout')) text = text.replace('dependencies {', 'dependencies {\n    implementation("androidx.constraintlayout:constraintlayout:2.2.1")');
  if (!text.includes('com.journeyapps:zxing-android-embedded')) text = text.replace('dependencies {', 'dependencies {\n    implementation("com.journeyapps:zxing-android-embedded:4.3.0")');
  text = text.replace(/org\.mozilla:rhino:[^"]+/, 'org.mozilla:rhino:1.7.15');
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
  if (!text.includes('org.mozilla:rhino')) {
    text = text.replace('dependencies {', `dependencies {
    implementation("org.mozilla:rhino:1.7.15")
    implementation("org.jsoup:jsoup:1.16.2")
    implementation("cn.hutool:hutool-all:5.8.22")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")`);
    fs.writeFileSync(gradle, text);
  }
  if (!text.includes('com.jayway.jsonpath:json-path')) {
    text = text.replace('dependencies {', 'dependencies {\n    implementation("com.jayway.jsonpath:json-path:2.9.0")');
    fs.writeFileSync(gradle, text);
  }
}
const activity = 'src-tauri/gen/android/app/src/main/java/com/suixincrazy/legado/MainActivity.kt';
if (fs.existsSync(activity)) fs.copyFileSync('mobile/android/MainActivity.kt', activity);
if (fs.existsSync(activity)) {
  for (const name of ['JavaBridgePlugin.kt', 'JavaBridgeEngine.java', 'SourceBrowser.kt', 'WelcomeView.kt', 'ReadAloudService.kt', 'QrScannerActivity.kt']) fs.copyFileSync(`mobile/android/${name}`, activity.replace('MainActivity.kt', name));
  fs.writeFileSync('src-tauri/gen/android/app/legado-rules.pro', '-keep class com.suixincrazy.legado.JavaBridgePlugin { *; }\n-keep class com.suixincrazy.legado.JavaBridgeArgs { *; }\n-keep class org.mozilla.javascript.** { *; }\n-keep class org.jsoup.** { *; }\n-keep class cn.hutool.** { *; }\n-keep class okhttp3.** { *; }\n-keep class com.jayway.jsonpath.** { *; }\n-keep class net.minidev.** { *; }\n-dontwarn org.slf4j.**\n-dontwarn com.fasterxml.jackson.**\n-dontwarn com.google.gson.**\n-dontwarn jakarta.json.**\n-dontwarn org.apache.tapestry5.json.**\n-dontwarn org.codehaus.jettison.json.**\n-dontwarn cn.hutool.**\n-dontwarn java.awt.**\n-dontwarn javax.swing.**\n-dontwarn javax.lang.model.**\n-dontwarn javax.tools.**\n-dontwarn java.beans.**\n');
}
const strings = 'src-tauri/gen/android/app/src/main/res/values/strings.xml';
if (fs.existsSync(strings)) fs.writeFileSync(strings, fs.readFileSync(strings, 'utf8').replace(/"Legado Reader"/g, '阅读'));
if (fs.existsSync(manifest)) {
  fs.cpSync('mobile/android/res', 'src-tauri/gen/android/app/src/main/res', { recursive: true });
  for (const variant of ['values', 'values-night']) {
    const theme = `src-tauri/gen/android/app/src/main/res/${variant}/themes.xml`;
    const background = variant === 'values-night' ? '#212121' : '#f5f5f5';
    fs.writeFileSync(theme, `<resources><style name="Theme.legado_tauri" parent="Theme.Material3.DayNight.NoActionBar"><item name="android:windowBackground">${background}</item><item name="android:colorAccent">#e53935</item><item name="android:statusBarColor">${background}</item><item name="android:navigationBarColor">${background}</item><item name="android:windowLightStatusBar">${variant === 'values'}</item></style></resources>\n`);
  }
}
