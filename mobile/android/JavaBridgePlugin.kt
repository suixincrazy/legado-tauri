package com.suixincrazy.legado

import android.app.Activity
import android.graphics.Color
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
    if (request.optString("operation") == "systemUi") {
      hostActivity.runOnUiThread {
        (hostActivity as? MainActivity)?.dismissWelcome()
        val dark = request.optBoolean("dark")
        @Suppress("DEPRECATION")
        hostActivity.window.statusBarColor = Color.parseColor(if (dark) "#546e7a" else "#795548")
        @Suppress("DEPRECATION")
        hostActivity.window.navigationBarColor = Color.parseColor(if (dark) "#303030" else "#eeeeee")
        val controller = WindowCompat.getInsetsController(hostActivity.window, hostActivity.window.decorView)
        controller.isAppearanceLightStatusBars = false
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
