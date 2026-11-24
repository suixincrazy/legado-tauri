# 上游审查与实现取舍

审查更新：2026-11-24。项目为 Tauri 2 重写，未将 Android/Kotlin 工程包装为网页。

| 上游 | 固定提交 |
| --- | --- |
| [LegadoTeam/legado](https://github.com/LegadoTeam/legado) | `330e606c4d57e08adc056ff8ab7a4132c784da9a` |
| [HapeLee/legado-with-MD3](https://github.com/HapeLee/legado-with-MD3) | `d89ccba48b649eeea5163b6f204ec44ce7bacf4b` |

## 界面基准

Legado `app/src/main/res/layout/activity_main.xml` 使用垂直内容区和 50dp 底部导航；`menu/main_bnv.xml` 提供书架、发现、订阅、我的四个入口，手机默认隐藏标签；`values/colors.xml` 定义 light-blue-600 主色和灰白背景。本实现保持这些结构、紧凑工具栏、书架网格/列表与轻量菜单。没有引入 MD3 的大圆角卡片、胶囊导航或动态配色。

## 采用的分支优点

| 证据 | 采用方式 |
| --- | --- |
| MD3 README 的阅读记录；`data/entities/readRecord`、`ReadRecordRepositoryTest.kt` | 按书籍、章节、日期保存阅读时间轴；后台不累计阅读时长 |
| README 的智能伴生分组 | 由真实阅读状态派生未读、在读、已读，避免维护重复分组状态 |
| README 的书籍备注 | 详情中编辑并随书库备份 |
| `ui/main/MainAdaptiveLayout.kt`、`ListDetailSceneStrategy.kt` | iPad 网格密度、横屏双页、窄窗口回流与安全区；使用窗口宽度而非设备名称判断 |
| README 的手柄翻页 | Gamepad API 与方向键、PageUp/PageDown 阅读翻页 |
| `ReaderEpubFileContractTest.kt`、`reader/semantic` 测试结构 | EPUB 按 spine 顺序导入；保持文本章节；建立本地格式契约测试 |

## 重要兼容边界

两个上游均为成熟 Android 工程，MD3 也不是完成的跨平台工程；其 AGENTS.md 明确记录 Android-first、Rhino/JVM、Room、Android 服务及原生渲染依赖。不能将目录改名或添加 Tauri 壳视作完整移植。

MD3 支持复杂 JavaScript/Java 书源。证据包括 `AnalyzeRule.kt` 的脚本求值和 chapter/book/ruleData 变量优先级，`AnalyzeUrl.kt` 的脚本请求模板，`SharedJsScope.kt` 的共享脚本库，以及 `JsExtensions.kt` 的网络、浏览器登录、验证码、编码/解密 API。首版 Tauri 不支持这些扩展是移植缺口，不是上游的限制。

`legado_app_3.26112401` 已加入独立 QuickJS WASM 虚拟机，执行 `@js:`、`<js>`、jsLib/mainJs、模板表达式和 CSS/JSON/JS 混合规则。Asyncify 桥保持 `java.ajax` 等同步书源语义，支持 HTTP GET/POST、动态请求头、GBK、Base64、MD5、AES/DES、繁简转换和书源/cache/cookie/书籍/章节状态。详情初始化保留对象，目录/正文支持多个下一页地址并去重。登录设置支持静态及脚本生成字段、按钮和 `loginCheckJs`。

Android 的 Tauri 插件通过 Rhino 1.7.15 转换 JVM 类型、处理重载和对象句柄，可使用 Java 标准库中的已开放类、JCA、Jsoup 1.16.2、Hutool 5.8.22、OkHttp 4.12.0。支持 `Packages`、`JavaImporter`、`importClass`，数组保留 Java 类型。网页验证使用独立 WebView，不注入 Tauri 或 JavaScript 原生接口；`startBrowserAwait`、`getVerificationCode` 和 `webView` 接入该窗口。需要交互时等待用户完成验证，回传页面和 Cookie。

iOS 的脚本同样运行于 QuickJS，常用 Java String/Arrays/Base64/Cipher/Jsoup/Hutool API 使用兼容实现；iOS 没有 JVM，任意 Java 库和 Android 类不能直接运行，网页验证窗口尚未接入。Android 也不具备上游所有 API：复杂网页登录自动判定、webViewGetSource/资源嗅探、依赖 Legado 内部类型或外部 JAR 的规则仍有缺口。漫画、有声书后台服务、WebDAV 和仿真翻页尚未移植。书源可导入不代表网站在线或规则完全兼容。

脚本 CPU 时间与内存有限额；JVM 类访问限制文件、反射/类加载器、进程执行和应用内部类型。规则在独立 VM 执行，页面执行只发生于隔离书源 WebView。原生库调用受 Java 类本身的行为约束，不将此实现称为通用恶意代码沙箱。

本地 EPUB 当前为文字阅读：读取元数据、封面、spine 顺序与章节，正文转为纯文本，去除脚本与嵌入框架。复杂图文排版、DRM、SVG 交互内容不在当前兼容范围。

## 数据与平台

书籍、正文缓存、书源、设置、阅读记录存入 IndexedDB，备份恢复先校验再在单个事务中合并。原生网络由 Rust reqwest 提供以避免网页 CORS；只接受 HTTP(S) GET/POST，限制响应大小与超时。iOS 编译产物、签名安装与实机验证状态分别报告，最新进度见验证记录。

代码以 GPL-3.0-or-later 发布，保留上游 GPL 文本和致谢。此项目与两个上游无官方从属关系。
