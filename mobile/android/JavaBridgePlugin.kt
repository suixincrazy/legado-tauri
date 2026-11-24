package com.suixincrazy.legado

import android.app.Activity
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
class JavaBridgePlugin(activity: Activity) : Plugin(activity) {
  private val engine = JavaBridgeEngine()
  private val executor = Executors.newSingleThreadExecutor()

  @Command
  fun execute(invoke: Invoke) {
    val args = invoke.parseArgs(JavaBridgeArgs::class.java)
    executor.execute {
      try { invoke.resolve(JSObject().put("json", engine.execute(JSONObject(args.payload)).toString())) }
      catch (error: Throwable) { invoke.reject(error.message ?: "Java source call failed") }
    }
  }
}
