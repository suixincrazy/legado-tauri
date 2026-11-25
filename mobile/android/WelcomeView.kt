package com.suixincrazy.legado

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.BitmapDrawable
import android.util.Base64
import android.view.LayoutInflater
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import org.json.JSONObject

class WelcomeView(context: Context, preferences: JSONObject) : FrameLayout(context) {
  init {
    LayoutInflater.from(context).inflate(R.layout.legado_welcome, this, true)
    val dark = preferences.optBoolean("dark")
    val accent = Color.parseColor(preferences.optString("accentColor", if (dark) "#d84315" else "#e53935"))
    setBackgroundColor(Color.parseColor(preferences.optString("backgroundColor", if (dark) "#212121" else "#f5f5f5")))
    val suffix = if (dark) "Dark" else ""
    val showText = preferences.optBoolean("welcomeShowText$suffix", true)
    findViewById<View>(R.id.tv_legado).visibility = if (showText) View.VISIBLE else View.GONE
    findViewById<TextView>(R.id.tv_gzh).apply { visibility = if (showText) View.VISIBLE else View.GONE; setTextColor(accent) }
    findViewById<TextView>(R.id.tv_title).setTextColor(accent)
    findViewById<TextView>(R.id.tv_sub_title).setTextColor(accent)
    findViewById<View>(R.id.vw_title_line).setBackgroundColor(accent)
    findViewById<ImageView>(R.id.iv_book).apply {
      visibility = if (preferences.optBoolean("welcomeShowIcon$suffix", true)) View.VISIBLE else View.GONE
      setColorFilter(accent)
    }
    if (preferences.optBoolean("customWelcome")) {
      val image = preferences.optString("welcomeImage$suffix")
      if (image.startsWith("data:image/")) runCatching {
        val bytes = Base64.decode(image.substringAfter(','), Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.let { background = BitmapDrawable(resources, it) }
      }
    }
  }
}
