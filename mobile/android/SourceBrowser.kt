package com.suixincrazy.legado

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import org.json.JSONTokener

// Remote pages have a separate WebView with no Tauri or JavaScript interface.
class SourceBrowser(private val activity: Activity) {
  fun open(request: JSONObject, complete: (JSONObject) -> Unit) {
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
    val input = EditText(activity).apply { hint = "输入验证码"; isSingleLine = true }
    val handler = Handler(Looper.getMainLooper())
    var finished = false
    lateinit var timeout: Runnable
    fun finish(result: JSONObject) {
      if (finished) return
      finished = true; handler.removeCallbacks(timeout)
      web.stopLoading(); dialog.dismiss(); web.destroy(); complete(result)
    }
    timeout = Runnable { finish(JSONObject().put("error", "书源浏览器等待超时")) }
    fun capture() {
      val script = request.optString("js").ifBlank { "document.documentElement.outerHTML" }
      web.evaluateJavascript(script) { value ->
        if (!finished) {
          val decoded = try { JSONTokener(value ?: "null").nextValue() } catch (_: Exception) { value ?: "" }
          val finalUrl = web.url ?: url
          CookieManager.getInstance().flush()
          finish(JSONObject().put("value", JSONObject().put("url", finalUrl).put("body", if (decoded == JSONObject.NULL) "" else decoded.toString()).put("status", 200).put("cookie", CookieManager.getInstance().getCookie(finalUrl) ?: "")))
        }
      }
    }
    web.settings.apply {
      javaScriptEnabled = true; domStorageEnabled = true
      allowFileAccess = false; allowContentAccess = false
      javaScriptCanOpenWindowsAutomatically = false
    }
    val headers = mutableMapOf<String, String>()
    request.optJSONObject("headers")?.let { values -> values.keys().forEach { key -> headers[key] = values.getString(key) } }
    headers.entries.firstOrNull { it.key.equals("Cookie", true) }?.let { CookieManager.getInstance().setCookie(url, it.value) }
    web.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = request.url.scheme !in listOf("http", "https", "about")
      override fun onPageFinished(view: WebView, loadedUrl: String) { if (!interactive && !finished) handler.postDelayed({ if (!finished) capture() }, 300) }
    }
    layout.addView(heading)
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
    dialog.show()
    dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    if (!interactive) dialog.window?.decorView?.alpha = 0f
    handler.postDelayed(timeout, if (interactive) 300000L else 30000L)
    if (request.has("html") && !request.isNull("html")) web.loadDataWithBaseURL(url, request.getString("html"), "text/html", "UTF-8", null)
    else web.loadUrl(url, headers)
  }
}
