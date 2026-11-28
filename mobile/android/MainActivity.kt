package com.suixincrazy.legado

import android.os.Bundle
import android.os.SystemClock
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private var welcome: View? = null
  private var readerWebView: WebView? = null
  private var welcomeStarted = 0L
  private var welcomeDuration = 500L
  private val connectivityReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) { networkChanged() }
  }
  private fun networkChanged() { readerWebView?.post { readerWebView?.evaluateJavascript("window.dispatchEvent(new Event('legado-network-change'))", null) } }
  override fun onResume() { super.onResume(); networkChanged() }
  override fun onDestroy() { unregisterReceiver(connectivityReceiver); super.onDestroy() }
  override fun setContentView(view: View?) {
    super.setContentView(view)
    // Wry replaces the content view after onCreate, before the web page is ready.
    welcome?.let { current ->
      (current.parent as? ViewGroup)?.removeView(current)
      findViewById<ViewGroup>(android.R.id.content).addView(current, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }
  }
  fun dismissWelcome() {
    val current = welcome ?: return
    val remove = {
      (current.parent as? ViewGroup)?.removeView(current)
      if (welcome === current) welcome = null
    }
    current.postDelayed({
      readerWebView?.postVisualStateCallback(0, object : WebView.VisualStateCallback() {
        override fun onComplete(requestId: Long) { remove() }
      }) ?: remove()
      // Some WebViews suppress the visual callback while fully covered by a native view.
      current.postDelayed({ remove() }, 300L)
    }, maxOf(0L, welcomeDuration - (SystemClock.elapsedRealtime() - welcomeStarted)))
  }
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    @Suppress("DEPRECATION")
    registerReceiver(connectivityReceiver, IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION))
    val content = findViewById<View>(android.R.id.content)
    val preferences = runCatching { JSONObject(getSharedPreferences("legado_ui", MODE_PRIVATE).getString("welcome", "{}") ?: "{}") }.getOrDefault(JSONObject())
    welcomeDuration = preferences.optLong("welcomeShowTime", 500L).coerceIn(0L, 800L)
    welcomeStarted = SystemClock.elapsedRealtime()
    if (welcomeDuration > 0L) welcome = WelcomeView(this, preferences).also { (content as? ViewGroup)?.addView(it, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)) }
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
      val bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val keyboard = windowInsets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    readerWebView = webView
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript("window.dispatchEvent(new Event('legado-back', {cancelable:true}))") { unhandled ->
          if (unhandled != "false") {
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            isEnabled = true
          }
        }
      }
    })
  }
}
