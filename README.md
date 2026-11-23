# 阅读 · Legado Tauri

以 [Legado](https://github.com/LegadoTeam/legado) 的经典界面为基准，采用 [legado-with-MD3](https://github.com/HapeLee/legado-with-MD3) 的阅读记录、智能分组、书籍备注和平板适配思路，用 Tauri 2、Rust、React、TypeScript 编写的 Android / iPadOS 阅读应用。

当前版本：`legado_app_3.26112301`。Tauri 包版本 `3.26.1123`，Android versionCode `26112301`。

## 功能

- TXT（UTF-8 / UTF-16 / GB18030）和文字 EPUB 导入、目录、阅读进度、书签。
- 书架网格/列表，自动未读/在读/已读分组，备注、阅读时间轴。
- 标准 Legado 文字书源 JSON 导入、搜索、发现、目录更新、章节缓存。
- CSS / XPath / JSONPath、基本替换与 GET/POST 网络请求。
- 滚动/左右翻页、字号、行距、段距、字体、纸张/白色/护眼/夜间主题。
- 11 英寸 iPad 竖屏、横屏双页、分屏窄窗口、安全区布局；键盘和手柄翻页。
- RSS / Atom 订阅，本机 JSON 备份恢复，系统 WebView 可用时朗读。

兼容边界和上游固定提交见 [审查报告](docs/UPSTREAM_REVIEW.md)。当前不是 Legado 的完整功能等价替代；Rhino/Java 扩展书源、复杂图文 EPUB、后台音频与 WebDAV 尚不支持。

## 开发与验证

需要 Node.js 22+、Rust stable。Android 需要 JDK 21、Android SDK 36、NDK 27.2.12479018。iOS 需要 macOS、Xcode 与 xcodegen。

```sh
npm ci
npm test
npm run build
npm run dev
```

Android：

```sh
rustup target add aarch64-linux-android x86_64-linux-android
npm run tauri -- android init --ci
node scripts/prepare-mobile.mjs
npm run tauri -- android build --debug --target aarch64 x86_64 --apk
```

设置 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME`，并将 Cargo 加入 PATH。生成的 Android 工程不提交，以初始化脚本和锁文件复现。开发 APK 使用调试签名；正式发布请使用自己的长期签名密钥。

macOS / iOS：

```sh
brew install xcodegen
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
npm run tauri -- ios init --ci
npm run tauri -- ios build --debug --target aarch64-sim
```

GitHub Actions 提供 Android 与 macOS 构建。iPad 模拟器 `.app` 不能直接安装到实体 iPad；设备 IPA 的安装需要 Apple 开发者签名或用户的侧载签名。编译与测试的实际结果见 [验证记录](docs/VALIDATION.md)。

## 数据与许可

数据默认保存在设备本地。卸载应用可能清除书库，请通过“我的 → 备份”导出。本项目不预置第三方书源或网络书籍。

GPL-3.0-or-later，参见 [LICENSE](LICENSE)。感谢 Legado、Legado with MD3 与所使用的开源依赖。
