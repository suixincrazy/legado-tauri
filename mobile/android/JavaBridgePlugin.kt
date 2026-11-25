package com.suixincrazy.legado

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.content.pm.ActivityInfo
import android.view.WindowManager
import androidx.core.view.WindowCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.Executors
import org.json.JSONObject

@InvokeArg
class JavaBridgeArgs { lateinit var payload: String }

@TauriPlugin
class JavaBridgePlugin(private val hostActivity: Activity) : Plugin(hostActivity) {
  private val engine = JavaBridgeEngine()
  private val executor = Executors.newSingleThreadExecutor()

  @Command
  fun execute(invoke: Invoke) {
    val args = invoke.parseArgs(JavaBridgeArgs::class.java)
    val request = JSONObject(args.payload)
    if (request.optString("operation") == "clipboard") {
      hostActivity.runOnUiThread {
        try {
          val clipboard = hostActivity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
          val value = when (request.optString("action")) {
            "read" -> clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(hostActivity)?.toString() ?: ""
            "write" -> { clipboard.setPrimaryClip(ClipData.newPlainText("阅读", request.optString("text"))); "" }
            else -> throw IllegalArgumentException("Invalid clipboard action")
          }
          invoke.resolve(JSObject().put("json", JSONObject().put("value", value).toString()))
        } catch (error: Throwable) { invoke.reject(error.message ?: "Clipboard failed") }
      }
      return
    }
    if (request.optString("operation") == "readAloud") {
      hostActivity.runOnUiThread {
        try { invoke.resolve(JSObject().put("json", ReadAloudService.command(hostActivity, request).toString())) }
        catch (error: Throwable) { invoke.reject(error.message ?: "Read aloud failed") }
      }
      return
    }
    if (request.optString("operation") == "readerScreen") {
      hostActivity.runOnUiThread {
        if (request.optBoolean("keepScreenOn")) hostActivity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else hostActivity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val attributes = hostActivity.window.attributes
        attributes.screenBrightness = request.optDouble("brightness", -1.0).toFloat()
        hostActivity.window.attributes = attributes
        hostActivity.requestedOrientation = when (request.optString("orientation")) {
          "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
          "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
          else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
        invoke.resolve(JSObject().put("json", "{}"))
      }
      return
    }
    if (request.optString("operation") == "welcome") {
      request.optJSONObject("preferences")?.let { hostActivity.getSharedPreferences("legado_ui", Activity.MODE_PRIVATE).edit().putString("welcome", it.toString()).apply() }
      if (request.optBoolean("ready")) hostActivity.runOnUiThread { (hostActivity as? MainActivity)?.dismissWelcome() }
      invoke.resolve(JSObject().put("json", "{}"))
      return
    }
    if (request.optString("operation") == "systemUi") {
      hostActivity.runOnUiThread {
        val dark = request.optBoolean("dark")
        @Suppress("DEPRECATION")
        hostActivity.window.statusBarColor = Color.parseColor(request.optString("primaryColor", if (dark) "#546e7a" else "#795548"))
        @Suppress("DEPRECATION")
        hostActivity.window.navigationBarColor = Color.parseColor(request.optString("bottomBackground", if (dark) "#303030" else "#eeeeee"))
        val controller = WindowCompat.getInsetsController(hostActivity.window, hostActivity.window.decorView)
        controller.isAppearanceLightStatusBars = request.optBoolean("lightStatusBar")
        controller.isAppearanceLightNavigationBars = !dark
        invoke.resolve(JSObject().put("json", "{}"))
      }
      return
    }
    if (request.optString("operation") == "browser") {
      hostActivity.runOnUiThread {
        try { SourceBrowser(hostActivity).open(request) { response -> invoke.resolve(JSObject().put("json", response.toString())) } }
        catch (error: Throwable) { invoke.reject(error.message ?: "Source browser failed") }
      }
      return
    }
    executor.execute {
      try { invoke.resolve(JSObject().put("json", engine.execute(request).toString())) }
      catch (error: Throwable) { invoke.reject(error.message ?: "Java source call failed") }
    }
  }
}
