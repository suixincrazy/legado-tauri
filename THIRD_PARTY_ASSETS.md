# Legado 资源来源

应用图标、底部导航、工具栏图标、默认封面与欢迎页书本图片来自 [LegadoTeam/legado](https://github.com/LegadoTeam/legado)，固定提交 `330e606c4d57e08adc056ff8ab7a4132c784da9a`，遵循其 GPL-3.0 许可。许可全文见 `LICENSE`。

Android 自适应图标直接保留 `ic_launcher1.xml`、`ic_launcher1_b.xml`、`ic_launcher4.xml` 和 `mipmap-anydpi-v26/ic_launcher.xml`，旧 Android 密度图片也来自上游。iOS/桌面图标由同一默认自适应图标矢量的可见区域生成。没有使用仓库中与默认 Android 启动器图标不同的 `ic_launcher-web.png`。

`public/legado/resources.json` 保存 UI 资源原路径和 SHA-256。`scripts/import-upstream-ui.py` 将 Android vector 转成 SVG，保留路径、描边和渐变。欢迎页布局参照 `activity_welcome.xml` 与 `WelcomeActivity.kt`；默认运行时颜色参照 `ThemeConfig.applyTheme`。

本项目是独立 Tauri 移植，与上游无官方从属关系。

`src/default-txt-rules.json` is copied from `app/src/main/assets/defaultData/txtTocRule.json` at the pinned Legado commit. `mobile/android/res/layout/legado_welcome.xml` preserves the upstream welcome constraints and text sizes, replacing the project-specific TextView class and resource names for Tauri. Both remain covered by the upstream GPL-3.0 license.

`src/ui.tsx` 默认封面竖排文字的坐标和缩放逻辑移植自同一固定提交的 `CoverImageView.generateCoverBitmap`。书源选择底栏、书架设置和发现展开布局分别参照 `view_select_action_bar.xml`、`dialog_bookshelf_config.xml` 和 `item_find_book.xml`。

`src/default-themes.json` 直接采用上述固定提交的 `app/src/main/assets/defaultData/themeConfig.json`，保留主题名称、颜色字段及 GPL-3.0 来源。

`src/default-dict-rules.json` 直接复制同一固定提交的 `app/src/main/assets/defaultData/dictRules.json`。词典规则列表、编辑、选文菜单与查询标签分别参照 `item_dict_rule.xml`、`dialog_dict_rule_edit.xml`、`content_select_action.xml` 和 `dialog_dict.xml`，保留 GPL-3.0 来源。

高亮模型与匹配范围参考同一提交的 `BookHighlight.kt`、`HighlightStyle.kt`、`HighlightStyles.kt`、`HighlightRuleMatcher.kt` 和 `HighlightAnchor.kt`，7个预设保留原ARGB颜色，界面参照 `dialog_highlight_style.xml` 和 `dialog_highlight_rule_edit.xml`。

`src/source-rule-help.md` 原样复制该固定提交的 `app/src/main/assets/web/help/md/ruleHelp.md`；`src/source-rule-complete.ts` 移植 `help/RuleComplete.kt` 的简单规则补全，字段范围对应 `BookSourceEditActivity.getSource`。`src/source-rule-complete.cases.json` 由同一上游 Kotlin 类在 JVM 上运行公开夹具生成。

`src/source-debug-help.md` 原样复制该提交的 `app/src/main/assets/web/help/md/debugHelp.md`。调试输入、示例和源码菜单参照 `Debug.kt`、`BookSourceDebugActivity.kt`、`activity_source_debug.xml` 和 `book_source_debug.xml`，编辑入口使用官方 `ic_bug_report`。

`src/source-manager-help.md` 原样复制同一固定提交的 `app/src/main/assets/web/help/md/SourceMBookHelp.md`。书源导出及分享格式参照 `BookSourceViewModel.saveToFile`、`BookSourceEditActivity` 和 `ContextExtensions.share`。
