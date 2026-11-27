# 上游审查与实现取舍

审查更新：2026-11-27。项目为 Tauri 2 重写，未将 Android/Kotlin 工程包装为网页。

| 上游 | 固定提交 |
| --- | --- |
| [LegadoTeam/legado](https://github.com/LegadoTeam/legado) | `330e606c4d57e08adc056ff8ab7a4132c784da9a` |
| [HapeLee/legado-with-MD3](https://github.com/HapeLee/legado-with-MD3) | `222978c5d00aec0f285610e6f3ed0d0936596743` |

## 界面基准

Legado `activity_main.xml` 使用 50dp 无标签底栏。实际默认主题由 `ThemeConfig.applyTheme` 设置为棕色 `#795548`、红色 `#e53935`、灰底 `#f5f5f5`，并非仅查看 `colors.xml` 得到的蓝色。本轮已按实际默认主题、原始图标／欢迎页资源和独立页面结构迁移。原版欢迎页没有独立 Lottie/逐帧动画，默认 500ms，进出依赖平台窗口过渡。iOS 静态 LaunchScreen 与进入后的欢迎页过渡分开实现。

完整入口清单和明确未迁移项见 [全面迁移审查](audit/COVERAGE.md)。当前尚未完成所有页面和交互的一比一迁移。

章节字数取自官方 `BookChapter.wordCount`、`AppConfig.tocCountWords`、`TocActivity.menu_load_word_count` 和 `ChapterListAdapter`。开关全局保存且默认开启，卷标题隐藏字数，普通行显示非空原值。`BookChapterList` 按 `AppPattern.wordCountRegex` 从章节信息识别字数；`BookHelp` 在启用时为新保存的在线文字正文计数。`StringUtils.wordCountFormat` 用 UTF-16 长度，严格大于 10000 才使用 `DecimalFormat("#.#")`。MD3 的 `TocViewModel`、`TocMenuActions` 也使用全局设置；其状态图标依据下载状态切换，本版按官方独立显示已有字数。新导入 EPUB 不自动生成全部字数，不将书籍总字数当作章节字数。ARMv7 模拟器验证了跨书开关、进程重启后保留设置、保存新正文时按开关计数，以及从系统导出的 ZIP 恢复关闭状态。TXT、SQLite 转换和格式阈值由自动化测试覆盖；本版 ARM64/iOS 交互尚未验证。详见 [验证记录](VALIDATION.md)。

长目录定位对照官方 `fragment_chapter_list.xml`、`ChapterListFragment` 和 `TocListState`。底栏首尾控制实际显示的列表，当前章按钮先在普通目录展开所属卷，搜索中依次回退到命中章、可见卷；查询变化从首行开始，回到普通目录时定位当前章或所属卷。MD3 `TocScreen` 使用浮动菜单和动画，本版采用官方底栏与上下箭头。定位不进入正文，多级 EPUB/PDF 导航不在本次实现范围。`26112709` 的 316 项公开测试、三尺寸浏览器实际可见边界及 ARMv7 模拟器验收通过：系统导入 181 行目录，验证当前行、首尾、倒序、搜索回退和折叠后定位；系统导出读回确认目录、正文、书签、进度及原有展开偏好保持。四阶段构建成功；ARM64/iOS 本版交互未验收，详见 [验证记录](VALIDATION.md)。

目录对照官方 `Book.ReadConfig.tocExpanded`（默认开启）、`TocActivity` 和 `TocListState`：按书保存默认展开状态，折叠时显示当前章所在卷；搜索遍历完整目录并显示匹配章节的祖先，退出搜索恢复手动折叠。MD3 的 `TocHierarchy` 和 `TocViewModel` 也区分普通和搜索列表；本版采用官方只包含相关卷的结果。现有扁平分卷支持卷内倒序，未实现多级 EPUB 导航树或 PDF 大纲。原版书架 ZIP、SQLite 转换和 Tauri ZIP 均处理单书偏好。`26112708` 的 ARMv7 模拟器已验证折叠卷搜索和清除、按书持久化及系统 ZIP 导出再恢复；ARM64/iOS 交互未验收，详见 [验证记录](VALIDATION.md)。

书签以官方 `Bookmark`、`BookmarkDao`、`BookmarkDialog`、`AllBookmarkViewModel` 及 `TocViewModel` 为基准。单书和全局均可导出原版八字段 JSON 及带章名、原文、摘要的 Markdown。全局 Markdown 在书名或作者任一项变化时生成新标题，避免不同书籍因共用作者或书名而连在一起。字符位置按 UTF-16、标题和段首缩进换算；Tauri 旧书签仅保存的比例位置无法反推出原始字符。

官方 `AllBookmarkActivity.onItemClick` 按书名及作者查询书架，未找到时打开 `BookmarkDialog`；`BookmarkDao.flowAll` 不连接书架表，`BookshelfManageViewModel.deleteBook` 不删除书签。`26112704` 据此保留移出书架后的书签，全局页可编辑、删除和导出。恢复或加入同名同作者书籍时再关联；全局操作按书名、作者和创建时间处理同一记录，合并 Tauri 多版本书籍造成的重复副本。MD3 的搜索及按书分组采用固定提交中的 `AllBookmarkViewModel` 作对照，保留官方列表外观；未迁移 MD3 全部批注面板。

下拉书签对照官方 `ReadView.onTouchEvent`、`ReadBookActivity.toggleBookmark` 和 `MoreConfigDialog`：默认关闭，分页或滚动章首允许下拉；最终松手位置须仍达到阈值且纵向占优。没有可见正文时不添加书签；有正文但尚无书签时直接添加，同页有多条时先确认。MD3 的 `PullBookmarkGesture` 同样拒绝在已交给翻页的手势中重新抢占指针；其 `ReadBookmarkDelegate` 在有多条时只删最近一条，本版采用官方的确认方式。Tauri 以当前 WebView 排版的可见 UTF-16 范围查询精确书签，旧比例位置不参与自动移除。浏览器/iOS 的默认触摸容差和页标记绘制不是 Android 原生视图。

`26112707` 在 ARMv7 模拟器通过系统 ZIP 恢复、默认关闭及自定义阈值、同页多条取消与确认、单条新增移除、后页角标与跨章返回、滚动章中不触发和章首切换验收。系统导出读回核对公开正文、另一章书签、页首字符位置及设置。297 项公开测试、三尺寸浏览器及移动端构建通过；本版 ARM64/iOS 交互及原生选文手柄等边界未验收，详见 [验证记录](VALIDATION.md)。

正文搜索对照官方 `ui/book/read/ContentSearch.kt` 及 `ui/book/searchContent/ContentSearchScope.kt`、`SearchContentViewModel.kt`、`SearchContentAdapter.kt`，另检查 MD3 的 `SearchContentRepository.kt`。官方字面匹配使用 UTF-16 坐标、区分大小写、非重叠匹配；向上从当前起点按章及命中位置倒序，向下正序，均包含起点。官方方向锚点用标题／正文分区指纹和邻文拒绝歧义定位。

`26112705` 的结果列出每次命中，使用实际显示的净化、简繁和分段结果，点击后重新校验字符锚点，滚动或翻页至目标并临时标出匹配词。正文指纹独立于标题长度；变化后只接受唯一邻文，无法确定时提示重搜。现有书签与手动高亮不被搜索改写。范围保存并随设置备份；仅搜索已缓存非分卷章节，逐章停止，上限 1,000 条。阅读菜单起点取当前可见字符，选文入口取选区起点。

`26112706` 依据官方 `AppConfig.contentSearchReplace`、`SearchContentViewModel.replaceEnabled` 及 `ContentProcessor.getContent` 新增搜索独立替换开关，默认关闭；只有搜索和本书同时启用时才应用有效标题／正文规则，不改本书的阅读开关。切换立即重搜并隔离旧响应。简繁、去重标题与重新分段仍使用阅读处理流程。MD3 的 `SearchContentRepository` 将替换开关列入会话有效性，当前实现采用对应的结果失效处理；历史和完整会话未迁移。

方向搜索捕获显示正文的起点锚点，转换到本次搜索正文后再比较命中位置；无法唯一对应时提示调整替换选项或全局搜索。全局搜索原文里的词如果已在阅读页被替换，也不能跳转，结果保留并提示重搜。正文变化后还要求邻文在原文本中唯一，防止删除一个重复段落后误跳到仅存副本。正文搜索范围及替换选择可从原版 `config.xml` 导入，并随 Tauri 设置备份；排除设置或忽略阅读配置时保留当前值。未宣称 Tauri 重新导出的原版配置 XML 已完整同步。

`26112706` 的 287 项公开测试、三尺寸浏览器检查和移动端构建通过。ARMv7 原生验证默认原词与开启后的净化词、同章及跨章跳页、本书禁用替换、系统 ZIP 导出读回的独立开关及原始正文、原版配置恢复后的开关和方向范围。ARM64/iOS 交互及原生选文手柄仍待验收，具体边界见 [验证记录](VALIDATION.md)。

Java 正则模式、MD3 搜索历史与完整会话仍未迁移，也不在线获取未缓存正文；隐藏标题不返回标题命中。正文编辑器已有的正则工具不代表阅读页支持正则搜索。

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

iOS 的脚本同样运行于 QuickJS，常用 Java String/Arrays/Base64/Cipher/Jsoup/Hutool API 使用兼容实现；iOS 没有 JVM，任意 Java 库和 Android 类不能直接运行，本版新增独立 WKWebView 验证窗口，尚未做本版 iOS 设备验收。Android 也不具备上游所有 API：复杂网页登录自动判定、webViewGetSource/资源嗅探、依赖 Legado 内部类型或外部 JAR 的规则仍有缺口。漫画及有声书专用阅读器尚未完整移植；WebDAV 已实现，原版全部设置语义与卷曲翻页算法尚未等价。书源可导入不代表网站在线或规则完全兼容。

脚本 CPU 时间与内存有限额；JVM 类访问限制文件、反射/类加载器、进程执行和应用内部类型。规则在独立 VM 执行，页面执行只发生于隔离书源 WebView。原生库调用受 Java 类本身的行为约束，不将此实现称为通用恶意代码沙箱。

本地 EPUB 当前为文字阅读：读取元数据、封面、spine 顺序与章节，正文转为纯文本，去除脚本与嵌入框架。复杂图文排版、DRM、SVG 交互内容不在当前兼容范围。

## 数据与平台

书籍、正文缓存、书源、设置、阅读记录存入 IndexedDB，备份恢复先校验再在单个事务中合并。原生网络由 Rust reqwest 提供以避免网页 CORS；只接受 HTTP(S) GET/POST，限制响应大小与超时。iOS 编译产物、签名安装与实机验证状态分别报告，最新进度见验证记录。

代码以 GPL-3.0-or-later 发布，保留上游 GPL 文本和致谢。此项目与两个上游无官方从属关系。

## 书源管理再审查（3.26112501）

对照原版 `res/menu/book_source.xml`、`book_source_sel.xml`、`ui/book/source/manage/BookSourceActivity.kt`、`ui/login/SourceLoginDialog.kt` 与 MD3 对应入口，补齐以下工作流：

| 上游行为 | Tauri 实现 |
| --- | --- |
| 名称、地址、分组搜索；未分组、启禁用、登录与发现筛选 | 本地筛选，名称、URL、手动、权重、更新、响应时间排序 |
| 多选管理 | 全选当前、反选、启禁用、发现开关、分组加删、置顶底、导出、删除确认 |
| 分组管理 | 精确分组匹配、重命名、移除；显示书架引用和校验状态 |
| 导入与更新 | 本地/URL/JSON 预览、逐项选择、冲突覆盖与用户状态保留、URL 订阅手动更新 |
| 新建和编辑 | 基本/登录/搜索/发现/详情/目录/正文/完整 JSON；未知字段保留，标识变更同步书架引用和登录状态 |
| 校验 | 搜索及详情、目录、正文流程，阶段日志、响应时间、失败筛选，停止后续检查 |
| 书源登录 | 先执行 loginUrl 再生成动态 loginUi，text/password/select/toggle/button/label、默认值、viewName、result、长按标志、回填和刷新、确认 login() |
| 发现分类 | JSON、脚本和标题::地址分类，选择分类请求、刷新、直接登录设置 |
| 网页登录 | Android WebView / iOS WKWebView，后退、刷新、电脑版切换、错误提示、Cookie 回传、预加载脚本和页面提取 |

网页登录依赖系统网络与代理配置。连接错误、服务端响应错误和规则解析错误分别处理；页面能加载不代表第三方书源全部功能可用。

仍需区分的上游能力：二维码导入、二维码分享、完整独立 JS source v2、原版详细规则调试器、资源嗅探、任意 JAR/Android 内部类尚未等价迁移。当前校验日志用于定位失败阶段，不是完整逐行 JS 调试器。停止检查会等待正在执行的请求返回。Android Cookie 清理覆盖书源记录的访问地址及常见根路径 Cookie；登录页的独立 WebView 存储按平台管理。

Cookie 兼容性检查发现 `cookie.getKey(url, key)` 误返回 origin，造成未登录被误判已登录；已依据上游 CookieStore 修正为读取指定 Cookie 值，并补充裸域名、Cookie 合并和清除的回归测试。

发现分类使用的 `infoMap.get/set/put/save/saveNow` 已接入持久状态。Cookie 域键按公共后缀解析匹配原版主域规则，兼容裸域名、子域和 http/https 访问；表单变量、请求客户端和浏览器清理均使用明确的书源上下文。

## 3.26112502 进行中的迁移

新增原始图标、欢迎页、原版默认主题、书源顶栏与行布局、完整字段目录、书架分组及批量管理、净化替换、纯 mainJs 搜索／详情／目录／正文管线。纯 JS 源仍有批量缓存和附加 API 缺口，不称为完整 v2 实现。Android 和 iOS 的 Java 兼容边界不变。
