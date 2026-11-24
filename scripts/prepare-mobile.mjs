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
  if (!text.includes('org.mozilla:rhino')) {
    text = text.replace('dependencies {', `dependencies {
    implementation("org.mozilla:rhino:1.7.15")
    implementation("org.jsoup:jsoup:1.16.2")
    implementation("cn.hutool:hutool-all:5.8.22")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")`);
    fs.writeFileSync(gradle, text);
  }
}
const activity = 'src-tauri/gen/android/app/src/main/java/com/suixincrazy/legado/MainActivity.kt';
if (fs.existsSync(activity)) fs.copyFileSync('mobile/android/MainActivity.kt', activity);
if (fs.existsSync(activity)) {
  for (const name of ['JavaBridgePlugin.kt', 'JavaBridgeEngine.java']) fs.copyFileSync(`mobile/android/${name}`, activity.replace('MainActivity.kt', name));
  fs.writeFileSync('src-tauri/gen/android/app/legado-rules.pro', '-keep class com.suixincrazy.legado.JavaBridgePlugin { *; }\n-keep class com.suixincrazy.legado.JavaBridgeArgs { *; }\n-keep class org.mozilla.javascript.** { *; }\n-keep class org.jsoup.** { *; }\n-keep class cn.hutool.** { *; }\n-keep class okhttp3.** { *; }\n-dontwarn cn.hutool.**\n-dontwarn java.awt.**\n-dontwarn javax.swing.**\n-dontwarn javax.lang.model.**\n-dontwarn javax.tools.**\n-dontwarn java.beans.**\n');
}
const strings = 'src-tauri/gen/android/app/src/main/res/values/strings.xml';
if (fs.existsSync(strings)) fs.writeFileSync(strings, fs.readFileSync(strings, 'utf8').replace(/"Legado Reader"/g, '阅读'));
