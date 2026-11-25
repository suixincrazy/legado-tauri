package com.suixincrazy.legado

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.RectF
import android.view.View

class WelcomeView(context: Context) : View(context) {
  private val density = resources.displayMetrics.density
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val book = BitmapFactory.decodeResource(resources, R.drawable.legado_welcome_book)

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    canvas.drawColor(Color.rgb(245, 245, 245))
    canvas.save()
    canvas.scale(density, density)
    val w = width / density
    val h = height / density
    val left = (w - 83f) / 2f
    val top = maxOf(12f, (h - 364f) * .4f)
    paint.color = Color.rgb(229, 57, 53)
    canvas.drawRect(left, top, left + 6f, top + 132f, paint)
    paint.textSize = 49f
    "阅读".forEachIndexed { index, character -> canvas.drawText(character.toString(), left + 12f, top + 49f + index * 66f, paint) }
    paint.textSize = 16f
    "享受美好时光".forEachIndexed { index, character -> canvas.drawText(character.toString(), left + 67f, top + 76f + index * 21f, paint) }
    paint.colorFilter = PorterDuffColorFilter(Color.rgb(229, 57, 53), PorterDuff.Mode.SRC_IN)
    canvas.drawBitmap(book, null, RectF(w / 2f - 60f, h - 204f, w / 2f + 60f, h - 84f), paint)
    paint.colorFilter = null
    val footer = "品读万千故事"
    canvas.drawText(footer, (w - paint.measureText(footer)) / 2f, h - 32f, paint)
    canvas.restore()
  }
}
