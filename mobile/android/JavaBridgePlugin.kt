package com.suixincrazy.legado

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.content.pm.ActivityInfo
import android.util.Base64
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.content.FileProvider
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.Executors
import org.json.JSONObject
import java.io.File
import java.util.UUID

@InvokeArg
class JavaBridgeArgs { lateinit var payload: String }

@TauriPlugin
class JavaBridgePlugin(private val hostActivity: Activity) : Plugin(hostActivity) {
  private val engine = JavaBridgeEngine()
  private val executor = Executors.newSingleThreadExecutor()
  private var qrPending = false

  @ActivityCallback
  fun qrResult(invoke: Invoke, result: ActivityResult) {
    qrPending = false
    val value = if (result.resultCode == Activity.RESULT_OK) result.data?.getStringExtra("text") else null
    invoke.resolve(JSObject().put("json", JSONObject().put("value", value ?: JSONObject.NULL).toString()))
  }

  @Command
  fun execute(invoke: Invoke) {
    val args = invoke.parseArgs(JavaBridgeArgs::class.java)
    val request = JSONObject(args.payload)
    if (request.optString("operation") == "qrCancel") {
      hostActivity.runOnUiThread { QrScannerActivity.cancelActive() }
      invoke.resolve(JSObject().put("json", "{\"value\":null}")); return
    }
    if (request.optString("operation") == "qrScan") {
      hostActivity.runOnUiThread {
        if (qrPending) invoke.reject("扫描窗口已经打开")
        else try {
          qrPending = true
          startActivityForResult(invoke, Intent(hostActivity, QrScannerActivity::class.java), "qrResult")
        } catch (error: Exception) { qrPending = false; invoke.reject(error.message ?: "无法打开扫描窗口") }
      }
      return
    }
    if (request.optString("operation") == "share") {
      hostActivity.runOnUiThread {
        try {
          val title = request.optString("title", "分享")
          val intent = Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_SUBJECT, title)
          if (request.has("name")) {
            val name = request.getString("name")
            require(name.isNotBlank() && name != "." && name != ".." && !name.contains('/') && !name.contains('\\')) { "Invalid share filename" }
            val cache = File(hostActivity.cacheDir, "legado-share").apply { mkdirs() }
            cache.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 86400000L }?.forEach { it.deleteRecursively() }
            val directory = File(cache, UUID.randomUUID().toString()).apply { mkdirs() }
            val file = File(directory, name).apply {
              if (request.has("base64")) writeBytes(Base64.decode(request.getString("base64"), Base64.DEFAULT))
              else writeText(request.optString("text"), Charsets.UTF_8)
            }
            val uri = FileProvider.getUriForFile(hostActivity, hostActivity.packageName + ".fileprovider", file)
            intent.type = request.optString("mime", "text/plain")
            intent.putExtra(Intent.EXTRA_STREAM, uri)
            intent.clipData = ClipData.newRawUri(name, uri)
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          } else {
            intent.type = "text/plain"
            intent.putExtra(Intent.EXTRA_TEXT, request.optString("text"))
          }
          hostActivity.startActivity(Intent.createChooser(intent, title))
          invoke.resolve(JSObject().put("json", "{\"value\":true}"))
        } catch (error: Throwable) { invoke.reject(error.message ?: "Share failed") }
      }
      return
    }
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
