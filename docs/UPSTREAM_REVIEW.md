# 上游审查与实现取舍

审查日期：2026-11-23。项目为 Tauri 2 重写，未将 Android/Kotlin 工程包装为网页。

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

本实现支持 Legado 文字书源 JSON 的标准 CSS、XPath、JSONPath 提取，搜索、目录、正文、相对地址、GET/POST、请求头、正文/目录下一页和基本替换。书源导入保留未支持字段；含 mainJs、jsLib、JavaScript/Java 扩展的规则会明确标注并拒绝执行，不在具有原生权限的 WebView 中 eval 外部代码。Rhino Java API、验证码登录、加密书源、漫画、有声书后台服务、复杂规则变量、WebDAV 和仿真翻页尚未移植。

本地 EPUB 当前为文字阅读：读取元数据、封面、spine 顺序与章节，正文转为纯文本，去除脚本与嵌入框架。复杂图文排版、DRM、SVG 交互内容不在当前兼容范围。

## 数据与平台

书籍、正文缓存、书源、设置、阅读记录存入 IndexedDB，备份恢复先校验再在单个事务中合并。原生网络由 Rust reqwest 提供以避免网页 CORS；只接受 HTTP(S) GET/POST，限制响应大小与超时。iOS 不进行实机调试，编译产物与签名/设备安装状态分别报告。

代码以 GPL-3.0-or-later 发布，保留上游 GPL 文本和致谢。此项目与两个上游无官方从属关系。
