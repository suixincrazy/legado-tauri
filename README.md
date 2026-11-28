# 阅读 · Legado Tauri

以 [Legado](https://github.com/LegadoTeam/legado) 的经典界面为基准，采用 [legado-with-MD3](https://github.com/HapeLee/legado-with-MD3) 的阅读记录、智能分组、书籍备注和平板适配思路，用 Tauri 2、Rust、React、TypeScript 编写的 Android / iPadOS 阅读应用。

新版采用自己的数据模型；需要继承旧书库时，通过独立的数据转换迁入。原版存储格式、双向导出恢复及字段逐项兼容不作为新版功能目标。

当前构建版本：`legado_app_3.26112808`。Tauri 包版本 `3.26.1128`，Android versionCode 和 iOS build number 均为 `26112808`。

订阅阅读历史默认记录主动打开的文章，按来源与地址区分，重读更新正文和最近时间；支持按来源查看、关闭记录和确认清空。历史与收藏独立，备份可以单独排除历史，收藏不带阅读时间。449 项测试、三尺寸浏览器和 ARMv7 升级、重读排序、记录开关、清空确认、真实断网重启及系统 ZIP 恢复通过。本版 ARM64/iOS 交互未验收。

订阅页新增文章收藏入口；阅读时可收藏正文快照、编辑标题和分组，离线查看、删除单条或分组。新版备份可单独选择收藏。433 项测试、三尺寸浏览器和 ARMv7 验收通过，包括升级保留、删除确认、真实断网重启及系统 ZIP 恢复。本版 ARM64/iOS 交互待验收。详见[验证记录](docs/VALIDATION.md)。

「我的 → 主界面设置」可以独立显示或隐藏发现、订阅，选择启动页面。启动入口隐藏时打开书架，重新显示后恢复原启动选择。417 项测试、三尺寸浏览器及 ARMv7 的开关组合、重启和新版 ZIP 恢复通过，书籍、书源与订阅保持。本版 ARM64/iOS 交互待验收。详见[验证记录](docs/VALIDATION.md)。

阅读记录增加默认开启的「简洁布局」。关闭后显示封面、当前或保存章节，以及阅读时长最高的三本书；同名不同作者分开显示，离架记录保留快照。405 项公开测试及生产构建通过，三尺寸浏览器和 ARMv7 验证封面回退、滚动后的布局菜单、断网缓存与本地图、重启和系统 ZIP 恢复。7 段记录共 400 秒，原书正文、书签和分组不变。ARM64/iOS 本版交互待验收。详见[验证记录](docs/VALIDATION.md)。

封面设置新增「仅 WiFi」，默认关闭。开启后，搜索和发现可继续显示已缓存的封面及本地图，只有新的网络封面需要 WiFi；书架和详情沿用官方例外。390 项公开测试通过，三个浏览器尺寸及 ARMv7 的真实 WiFi 切换、重启和系统 ZIP 恢复已验收。本版 ARM64/iOS 交互待验收。详见[验证记录](docs/VALIDATION.md)。

书籍详情支持分享原版格式的书籍信息，包含书源回调、系统分享及浏览器文本预览。ARMv7 已验证网络书、本地书和未入架预览的面板打开与取消；分享后系统导出的四本公开书、正文、书签、高亮和阅读位置均未变。376 项测试及三尺寸浏览器检查通过，ARM64/iOS 交互待验收。本地分享不包含书籍文件。详见 [验证记录](docs/VALIDATION.md)。

最新构建保持 Release 草稿。已发布安装包见 [Releases](https://github.com/suixincrazy/legado-tauri/releases)。支持构建 Android `armeabi-v7a`、`arm64-v8a`，以及 iOS arm64；另提供用于测试的 Android `x86_64` 包。

书架的「更新目录」只处理当前分组及筛选范围内允许更新的网络书。分组可开启「只更新已读」，只检查已读到当前目录末章的书。下拉刷新使用同一范围；分组关闭下拉刷新后，仍可通过菜单更新。365 项公开测试、三尺寸浏览器和 ARMv7 的真实下拉、菜单、重启及系统 ZIP 恢复通过；ARM64/iOS 本版交互待验收。详见[验证记录](docs/VALIDATION.md)。

目录中的「使用替换」默认关闭。开启后，允许替换的书按标题规则显示卷名、章名；搜索和底部定位仍使用原章名。「加载字数」独立生效，切换显示不会改写章节、书签或进度。338 项公开测试、三尺寸浏览器和 ARMv7 系统导入、重启记忆、ZIP 导出读回与再恢复已通过；本版 ARM64/iOS 交互尚未验收。详见 [验证记录](docs/VALIDATION.md)。

分组可独立选择书籍排序，或默认跟随全局。手动模式提供触屏拖动手柄和方向键移动；只更新书籍顺序，保留当前分组以外书籍的位置。`26112801` 已在 ARMv7 模拟器上验证：改动全局排序只影响选择「默认」的分组；重启应用或从系统 ZIP 恢复后，手动分组仍保留拖动后的顺序。352 项公开测试及三尺寸浏览器验证通过；本版 ARM64/iOS 交互待验收。详见 [验证记录](docs/VALIDATION.md)。

## 功能

- TXT（UTF-8 / UTF-16 / GB18030）和文字 EPUB 导入、目录及阅读进度；可摘录当前可见正文或选文，编辑书签原文与摘要，按字符位置跳转，按单书或全部导出 JSON / Markdown。未入架书签也能在全局页编辑和导出；移书后保留，重新加入同名同作者的书时再关联。
- 书架普通/紧凑列表、2～6列网格、六种排序、进度/未读角标，可选阅读状态分组，备注、阅读时间轴。
- 标准 Legado 文字书源 JSON 导入；搜索历史/范围/分页/去重、发现展开分类与脚本控件、目录更新、章节缓存。
- 原版TXT目录规则库、规则管理/导入导出/测试/重分章；书籍详情、换源与进度书签映射。
- CSS / XPath / JSONPath、基本替换与 GET/POST 网络请求。
- QuickJS 执行 `@js:`、`<js>`、`jsLib`、`mainJs`，支持同步书源网络调用、变量、Cookie、摘要与 AES/DES 解密。
- Android 通过原生 JVM 桥调用 Jsoup、Hutool、Java 加密等库；支持独立书源登录窗口、验证码输入和网页脚本提取。
- 书源分组、筛选排序、批量启禁用、置顶底、导入预览、冲突合并、订阅更新、规则编辑与校验。
- 动态登录表单、网页账号登录、登录请求头、`loginCheckJs`；书源状态、管理设置与订阅随备份保存。
- 滚动/左右翻页、字号、行距、段距、字体、纸张/白色/护眼/夜间主题。
- 已缓存正文的逐次字面搜索，保留阅读简繁和分段设置；可独立开启搜索替换，默认关闭并记忆选择。全局／向上／向下范围、命中摘录、精确跳转及临时高亮；逐章停止，最多显示 1,000 处。
- 11 英寸 iPad 竖屏、横屏双页、分屏窄窗口、安全区布局；键盘和手柄翻页。
- RSS / Atom 订阅，本地/WebDAV ZIP 备份恢复、内容选择与恢复忽略、前台自动备份、原版 2.x/3.x 备份读取、备份帮助与日志、进度同步与本地书自动上传/恢复。
- 原版备份中的共享排版、细体、日夜颜色、主题/书架设置、固化封面、归档背景及封面字体恢复；包含官方内置阅读背景。
- 多类型规则订阅备份往返、ID 合并及旧副本升级恢复；独立规则订阅列表支持新增、编辑、排序，书源、RSS 规则源和替换规则支持手动预览导入。

兼容边界和上游固定提交见 [审查报告](docs/UPSTREAM_REVIEW.md)。Android 已支持 Java 扩展调用；iOS 使用常用 Java API 兼容层，无法执行任意 JVM/Android 类，已接入独立 WKWebView 书源验证窗口，尚未实机验收。复杂图文 EPUB、漫画等仍未完整移植；WebDAV 与 LAN 已实现，跨设备验收待完成，不能承诺所有上游书源均可用。

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
rustup target add armv7-linux-androideabi aarch64-linux-android x86_64-linux-android
npm run tauri -- android init --ci
node scripts/prepare-mobile.mjs
npm run tauri -- android build --target armv7 aarch64 x86_64 --split-per-abi --apk
```

设置 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME`，并将 Cargo 加入 PATH。生成的 Android 工程不提交，以初始化脚本和锁文件复现。正式打包需配置 `ANDROID_KEYSTORE_PATH`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`；本地调试可加 `--debug`。GitHub Release 使用保存在仓库 Secrets 的固定密钥签名，支持后续覆盖更新。签名私钥不进入源码。

macOS / iOS：

```sh
brew install xcodegen
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
npm run tauri -- ios init --ci
node scripts/prepare-ios.mjs
npm run tauri -- ios build --debug --target aarch64-sim
```

上述模拟器命令适用于 Apple Silicon Mac。设备包使用 `npm run tauri -- ios build --target aarch64 --no-sign`。GitHub Actions 构建签名 Android APK、iOS 设备无签名 IPA 与 Xcode 工程；设备 IPA 的安装需要 Apple 开发者签名或用户的侧载签名。编译与测试的实际结果见 [验证记录](docs/VALIDATION.md)。

## 数据与许可

数据默认保存在设备本地。卸载应用可能清除书库，请通过“我的 → 备份与恢复”导出。本项目不预置第三方书源或网络书籍。

GPL-3.0-or-later，参见 [LICENSE](LICENSE)。感谢 Legado、Legado with MD3 与所使用的开源依赖。

## 全面迁移进度

原版图标、启动欢迎页、默认棕红主题与页面结构正在迁移；前端仍有明确差异。全量菜单、设置、XML/Compose 页面、脚本接口、发布记录清单见 [审查矩阵](docs/audit/COVERAGE.md)。未验收的功能不会标记为完整兼容。资源出处见 [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md)。
