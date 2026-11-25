package com.suixincrazy.legado

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.WebResourceResponse
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ProgressBar
import android.view.KeyEvent
import android.view.WindowManager
import org.json.JSONObject
import org.json.JSONTokener

// Remote pages have a separate WebView with no Tauri or JavaScript interface.
class SourceBrowser(private val activity: Activity) {
  fun open(request: JSONObject, complete: (JSONObject) -> Unit) {
    if (request.optString("mode") == "clearCookies") {
      val manager = CookieManager.getInstance()
      val urls = request.optJSONArray("urls")
      for (index in 0 until (urls?.length() ?: 0)) {
        val address = urls!!.getString(index)
        val uri = android.net.Uri.parse(address)
        val host = uri.host ?: continue
        val names = (manager.getCookie(address) ?: "").split(';').map { it.substringBefore('=').trim() }.filter { it.isNotEmpty() }
        val domains = host.split('.').let { parts -> (0..maxOf(0, parts.size - 2)).map { parts.drop(it).joinToString(".") } }
        for (name in names) {
          manager.setCookie(address, "$name=; Max-Age=0; Path=/")
          for (domain in domains) manager.setCookie(address, "$name=; Max-Age=0; Path=/; Domain=$domain")
        }
      }
      manager.flush(); complete(JSONObject().put("value", "")); return
    }
    val url = request.optString("url")
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      complete(JSONObject().put("error", "浏览器地址必须为 HTTP(S)")); return
    }
    val mode = request.optString("mode", "login")
    val interactive = mode != "render"
    val dialog = Dialog(activity)
    val layout = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE) }
    val heading = TextView(activity).apply { text = request.optString("title", "书源验证"); textSize = 18f; setPadding(20, 16, 20, 16) }
    val web = WebView(activity)
    val status = TextView(activity).apply { setPadding(20, 6, 20, 6); text = "正在加载…" }
    val progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal)
    val input = EditText(activity).apply { hint = "输入验证码"; isSingleLine = true }
    val handler = Handler(Looper.getMainLooper())
    var finished = false
    var pageFailed = false
    val visited = linkedSetOf(url)
    lateinit var timeout: Runnable
    fun finish(result: JSONObject) {
      if (finished) return
      finished = true; handler.removeCallbacks(timeout)
      web.stopLoading(); dialog.dismiss(); web.destroy(); complete(result)
    }
    timeout = Runnable { finish(JSONObject().put("error", "书源浏览器等待超时")) }
    fun capture() {
      if (pageFailed) { status.text = "网页尚未加载成功，请刷新重试。"; return }
      val script = request.optString("js").ifBlank { "document.documentElement.outerHTML" }
      web.evaluateJavascript(script) { value ->
        if (!finished) {
          val decoded = try { JSONTokener(value ?: "null").nextValue() } catch (_: Exception) { value ?: "" }
          val finalUrl = web.url ?: url
          visited.add(finalUrl)
          CookieManager.getInstance().flush()
          val cookies = JSONObject()
          visited.forEach { address -> cookies.put(address, CookieManager.getInstance().getCookie(address) ?: "") }
          finish(JSONObject().put("value", JSONObject().put("url", finalUrl).put("body", if (decoded == JSONObject.NULL) "" else decoded.toString()).put("status", 200).put("cookie", CookieManager.getInstance().getCookie(finalUrl) ?: "").put("cookies", cookies)))
        }
      }
    }
    web.settings.apply {
      javaScriptEnabled = true; domStorageEnabled = true
      allowFileAccess = false; allowContentAccess = false
      javaScriptCanOpenWindowsAutomatically = false
      useWideViewPort = true; loadWithOverviewMode = true
    }
    val headers = mutableMapOf<String, String>()
    request.optJSONObject("headers")?.let { values -> values.keys().forEach { key -> headers[key] = values.getString(key) } }
    headers.entries.firstOrNull { it.key.equals("Cookie", true) }?.let { entry -> entry.value.split(';').forEach { CookieManager.getInstance().setCookie(url, it.trim()) } }
    headers.entries.firstOrNull { it.key.equals("User-Agent", true) }?.let { web.settings.userAgentString = it.value }
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
    web.webChromeClient = object : WebChromeClient() { override fun onProgressChanged(view: WebView, value: Int) { progress.progress = value } }
    fun failed(message: String) {
      pageFailed = true; status.text = message
      if (!interactive) finish(JSONObject().put("error", message))
    }
    web.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = request.url.scheme !in listOf("http", "https", "about")
      override fun onPageStarted(view: WebView, address: String, icon: android.graphics.Bitmap?) { pageFailed = false; visited.add(address); status.text = "正在加载…" }
      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (request.isForMainFrame) {
          val proxy = error.description.toString().contains("PROXY", true)
          failed(if (proxy) "代理连接失败，请检查系统代理地址和端口后刷新。" else "网页加载失败（${error.errorCode}），请检查网络后刷新。")
        }
      }
      override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) { if (request.isForMainFrame && response.statusCode >= 400) failed("网页返回 HTTP ${response.statusCode}，请稍后重试。") }
      override fun onReceivedSslError(view: WebView, handler: android.webkit.SslErrorHandler, error: android.net.http.SslError) { handler.cancel(); failed("网页证书验证失败，请检查设备时间和网络。") }
      override fun onPageFinished(view: WebView, loadedUrl: String) {
        visited.add(loadedUrl)
        if (!pageFailed) status.text = "页面已加载，登录后点击完成。"
        if (request.has("preloadJs")) view.evaluateJavascript(request.optString("preloadJs"), null)
        if (!interactive && !finished && !pageFailed) handler.postDelayed({ if (!finished) capture() }, 400)
      }
    }
    val toolbar = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
    toolbar.addView(Button(activity).apply { text = "关闭"; setOnClickListener { finish(JSONObject().put("error", "已取消书源验证")) } })
    toolbar.addView(Button(activity).apply { text = "后退"; setOnClickListener { if (web.canGoBack()) web.goBack() } })
    toolbar.addView(Button(activity).apply { text = "刷新"; setOnClickListener { pageFailed = false; web.reload() } })
    layout.addView(toolbar)
    layout.addView(heading)
    layout.addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 4))
    layout.addView(status)
    layout.addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    if (mode == "code") layout.addView(input)
    layout.addView(Button(activity).apply {
      text = if (mode == "code") "提交验证码" else "完成验证，继续阅读"
      setOnClickListener {
        if (mode == "code") finish(JSONObject().put("value", input.text.toString())) else capture()
      }
    })
    dialog.setContentView(layout)
    dialog.setOnCancelListener { finish(JSONObject().put("error", "已取消书源验证")) }
    dialog.setOnKeyListener { _, key, event -> if (key == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP && web.canGoBack()) { web.goBack(); true } else false }
    dialog.show()
    dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    if (!interactive) dialog.window?.decorView?.alpha = 0f
    handler.postDelayed(timeout, if (interactive) 300000L else 30000L)
    if (request.has("html") && !request.isNull("html")) web.loadDataWithBaseURL(url, request.getString("html"), "text/html", "UTF-8", null)
    else web.loadUrl(url, headers)
  }
}
