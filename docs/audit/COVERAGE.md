# 全面迁移审查

审查日期：2026-11-25。本表是迁移差异清单，不是“全部功能完成”的声明。

基线：官方滚动 beta `legado_app_3.26110117` 对应 `330e606c4d57e08adc056ff8ab7a4132c784da9a`；正式版 `3.26101819` 对应 `a7d37f1707a70a459ad708f4fe79341d1e42d716`。MD3 `3.26.31`，源码 `222978c5d00aec0f285610e6f3ed0d0936596743`。滚动 beta 的最初发布时间不代表它当前的更新日期。

## 审查边界

`scripts/audit-upstream.py` 生成两个上游的菜单、设置 XML、布局、Compose 函数、设置键使用、脚本接口签名及 release 正文行。MD3 的 Compose 页面不能用 XML 数量代表。自动发现的同名接口不能证明参数、返回值、异常、线程和平台语义等价。

| 清单 | 内容 |
| --- | --- |
| [menus-settings.csv](menus-settings.csv) | 932 条菜单／设置记录，保留上游文件和标识 |
| [layouts.csv](layouts.csv) | 298 个 XML 布局；官方为 253 个 |
| [compose-ui.csv](compose-ui.csv) | 1329 个 Compose 函数，包含子组件，不能当作独立功能数 |
| [settings-key-usage.csv](settings-key-usage.csv) | 286 处设置键使用，可能重复 |
| [script-api.csv](script-api.csv) | 390 个脚本相关函数签名，包含重载；需要按语义验收 |
| [release-changes.csv](release-changes.csv) | 官方 44、MD3 112 条 release 的 4625 行正文，包括非功能说明 |

逐条 CSV 中未完成验收的状态保留“未逐项验收”。下表是已经检查源码与当前实现后确认的功能域差异。新增代码、测试通过、设备验收分别记录。

## 功能对照

| 功能域／上游入口 | 当前实现及证据 | 未等价部分 |
| --- | --- | --- |
| 默认图标 `mipmap-anydpi-v26/ic_launcher.xml` | 原始 `ic_launcher1` 前景／背景、单色层和各密度 PNG；iOS 由相同矢量生成 | iOS 系统遮罩与 Android 不同 |
| 欢迎页 `WelcomeActivity` / `activity_welcome` | 竖排文字、6dp 线、49sp/16sp 字体、120dp 书图、底部文案；默认 500ms；日夜文字／图标／背景配置 | 上游无独立 Lottie/逐帧动画；WebView 淡出是跨框架过渡，尚未做帧级一致性验收；iOS LaunchScreen 静态 |
| 主界面 `activity_main/main_bnv` | 棕色 `#795548`、红色 `#e53935`、灰底；四个原版图标，50dp 底栏，分组在顶栏 | 自定义底栏皮肤、可见入口配置、透明背景、动画参数未全迁移 |
| 书架 `main_bookshelf` / grid/list | 列表与可选列数网格、最近阅读、状态分组、自定义分组 | 第二列表样式、封面角标、完整排序和分组独立规则、拖动排序仍有缺口 |
| 书架管理 `bookshelf_manage/sel` | 选择、反选、批量更新开关、已读、分组、清理网络正文缓存、删除确认 | 批量换源、封面固化／恢复、检查间隔、自动更新任务未迁移 |
| 分组 `book_group_manage` | 名称、显示、排序、更新开关，删除同步书籍引用 | 封面、分组独立排序、只更新已读等未迁移 |
| 本地导入 `import_book` | TXT UTF-8/UTF-16/GB18030、EPUB spine 与封面；自动分章有测试 | 文件夹扫描、ZIP/RAR、图文 EPUB、原版自定义 TXT 目录规则、Markdown/CBZ 未迁移 |
| 远程书籍 `book_remote/servers` | 无 | WebDAV、服务器配置、目录浏览、下载队列 |
| 搜索 `book_search/book_search_scope` | 多源并发搜索、单源搜索、错误汇总；纯 JS source 分页参数 | 下一页 UI、搜索历史、搜索范围、精准匹配、分组搜索、完整去重／换源搜索未等价 |
| 发现 `main_explore` | 声明式／JSON／JS 分类，登录入口，选中分类搜索 | 样式规则、缓存策略、完整分页和源内导航未等价 |
| 详情 `book_info` | 居中封面、作者来源进度、简介、目录、编辑信息、备注、阅读、移出书架、缓存 | 换源、封面搜索、下载文件源、书评／段评、详情全部菜单未迁移 |
| 目录／书签 `book_toc/bookmark` | 搜索、倒序、分卷折叠、已缓存标识、进度跳转、书签增删、全局书签 | 跨页选文书签、书签导出、卷默认偏好、字数加载、目录规则未等价 |
| 阅读菜单 `view_read_menu/book_read` | 浮动正文搜索／自动阅读／夜间；底部目录／朗读／界面／设置；手柄及键盘翻页 | 自定义菜单、所有动作位置、亮度条、锁定／旋转、原版动画和翻页算法未等价 |
| 阅读排版 `dialog_read_book_style` | 字体类别、字号、加粗、缩进、行距、段距、配色、横屏双页 | 外部字体、章节标题独立字体、背景纹理／图片、上下左右边距、下划线参数、全部翻页模式未等价 |
| 正文搜索 `content_search` | 搜索已缓存章节并定位章节 | 未缓存章节的在线搜索、命中词精确定位／高亮未迁移 |
| 净化替换 `replace_rule/replace_edit` | 原版 JSON 字段、启停、编辑、批量操作、导入导出、作用／排除范围、正文／标题、保存测试样例；Worker 超时 | Java 正则差异、书源导入替换、完整分组排序与分享未等价 |
| 词典／高亮 `dict_rule/highlight_rule` | 无 | 规则管理、选择文字操作、词典网络查询、高亮匹配 |
| TXT 目录规则 `txt_toc_rule` | 固定内置规则 | 原版规则库、管理、导入、测试和应用未迁移 |
| 书源列表 `book_source/sel` | 原版资源的搜索、排序、分组、多选底栏；编辑／登录／搜索／校验／复制／导出／删除 | 拖动排序、二维码、导入净化、完整分享与维护动作未等价 |
| 书源编辑 `source_edit` | 按原版字段顺序生成基本／搜索／发现／详情／目录／正文／段评；字段导航，JSON 和 mainJs | 段评等字段保存不代表执行支持；语法着色、代码联想、测试入口和全量表单行为未等价 |
| 校验调试 `book_source_debug` | 搜索→详情→目录→正文，阶段日志、响应时间、失败筛选、停止后续检查 | 原版详细规则调试、任意输入片段、源字段定位、完整并发／取消未等价 |
| 书源登录 `source_login/source_webview_login` | 动态表单、按钮和长按、回填／刷新、独立 WebView/WKWebView、电脑版、Cookie；上一版真实私源验收 | 未完成真实账号登录；第三方服务故障仍独立存在；资源嗅探、自动验证判定等未等价 |
| 书源订阅 `source_subscription` | URL 保存、手动更新、导入预览、覆盖与状态保留 | 自动更新调度、订阅独立设置、二维码未等价 |
| 声明式规则 `AnalyzeRule/AnalyzeUrl` | CSS/部分 Jsoup/XPath/JSONPath/JS、模板、分页、网络、编码／解密、持久变量，自动测试覆盖 | 不能声明全部 Jsoup、Java 正则、全部请求选项和限制器等价 |
| 纯 JS 源 `JsSourceEngine/JsSourceBook` | 同时加载 jsLib/mainJs；search/explore/getBookInfo/getChapters/getContent，缺省详情、变量、相对目录、分卷有测试 | getContentBatch/cacheContent、段评、文件／图片／音频源、完整返回字段和 sourceApi 未等价 |
| Java 桥 | Android Rhino＋JVM、Jsoup/Hutool/JCA；iOS 常用 Java API 兼容实现 | iOS 没有 JVM；任意 Android 类／内部类型、JAR 装载不等价；参见 script-api.csv |
| 漫画／音频／视频 `book_manga/audio_play/video_play` | 无专用阅读器 | 漫画方向／裁边／OCR／翻译／CBZ、媒体控制、后台服务等 |
| 朗读 `speak_engine` | Web Speech 前台朗读；不可用时明确报错 | 原生 TTS、HTTP 引擎、后台通知、耳机控制、定时、系统语速跟随未等价 |
| 订阅 `rss_*` | 普通 RSS/Atom 拉取与纯文本阅读 | 原版规则源、收藏、历史、媒体、正文替换、调试与阅读设置未迁移 |
| 备份 `backup_restore` | 本应用 JSON 事务恢复，包含分组、替换规则、源状态 | 原版 ZIP 互通、WebDAV、LAN／二维码、备份合并选择未等价 |
| 阅读记录 `book_read_record` | 本机时间轴、章节和时长；后台不累计 | 原版设备／作者合并，MD3 统计筛选与完整图表未等价 |
| 主题／设置 `pref_config_*` | 日夜主题、阅读配置、欢迎页、书架布局 | 设置搜索、主题管理／导入、图标切换、通用设置全部字段未等价 |
| 自动任务／服务 `auto_task/pref_main` | 无 | 自动更新任务、web service、MCP、后台管理 |
| 辅助工具 `qr_code_scan/file_chooser/app_log` | 系统文件选择、错误提示 | QR、完整文件管理、字体管理、应用日志／崩溃查看、版本更新 UI |
| MD3 额外功能 | 时间轴、备注、状态分组、手柄、平板双页 | AI、漫画气泡／翻译、系列折叠、缓存维护等多数未迁移|

## 验证与下一步

本轮新增功能必须以测试和产物实测为准，详见 `../VALIDATION.md`。不将旧版 iPad 实测算作新版验收。验证材料使用公开样例。

仍有大量明确迁移工作，不能把此版描述为“全部前端照搬完成”或“完整兼容原版”。需要继续按上表逐项实现，并将 CSV 的具体入口与设备验收证据关联；自动枚举本身不是审查完成。
