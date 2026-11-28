package com.suixincrazy.legado

import android.content.Context
import android.net.ConnectivityManager
import android.util.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

object CoverImages {
  private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
    .connectTimeout(15, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).callTimeout(30, TimeUnit.SECONDS).build()
  @Suppress("DEPRECATION")
  fun network(context: Context): JSONObject {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    return JSONObject().put("wifi", manager.getNetworkInfo(ConnectivityManager.TYPE_WIFI)?.isConnected == true)
      .put("online", manager.activeNetworkInfo?.isConnected == true)
  }
  fun load(context: Context, request: JSONObject): JSONObject {
    val onlyWifi = request.optBoolean("onlyWifi")
    fun allowed() { check(!onlyWifi || network(context).optBoolean("wifi")) { "Only WiFi cover loading is enabled" } }
    var url = request.getString("url")
    repeat(6) {
      allowed()
      val call = client.newCall(Request.Builder().url(url).build())
      call.execute().use { response ->
        if (response.isRedirect) {
          val location = response.header("Location") ?: error("Cover redirect has no address")
          url = response.request.url.resolve(location)?.toString() ?: error("Invalid cover redirect")
        } else {
          check(response.isSuccessful) { "Cover request failed" }
          val body = response.body ?: error("Empty cover")
          check(body.contentLength() <= 4 * 1024 * 1024) { "Cover exceeds 4 MiB" }
          val mime = body.contentType()?.let { "${it.type}/${it.subtype}" } ?: "image/jpeg"
          check(mime.startsWith("image/")) { "Response is not an image" }
          val output = ByteArrayOutputStream()
          body.byteStream().use { input ->
            val buffer = ByteArray(16384)
            while (true) {
              allowed()
              val count = input.read(buffer); if (count < 0) break
              check(output.size() + count <= 4 * 1024 * 1024) { "Cover exceeds 4 MiB" }
              output.write(buffer, 0, count)
            }
          }
          allowed()
          return JSONObject().put("value", JSONObject().put("mime", mime).put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)))
        }
      }
    }
    error("Too many cover redirects")
  }
}
