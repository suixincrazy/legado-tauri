package com.suixincrazy.legado

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ImageButton
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import com.journeyapps.barcodescanner.DefaultDecoderFactory
import java.lang.ref.WeakReference
import java.util.concurrent.Executors

class QrScannerActivity : ComponentActivity() {
  companion object {
    private var active = WeakReference<QrScannerActivity>(null)
    fun cancelActive() { active.get()?.finish() }
  }
  private lateinit var camera: DecoratedBarcodeView
  private lateinit var status: TextView
  private val decoder = Executors.newSingleThreadExecutor()
  private var completed = false
  private var selectingImage = false
  private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) resumeCamera() else status.text = "相机权限未开启，可从图库选择二维码"
  }
  private val gallery = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
    if (uri == null) { selectingImage = false; resumeCamera() }
    else decoder.execute {
      try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "无法读取图片" }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 2048) sample *= 2
        val bitmap = contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) } ?: error("无法读取图片")
        val width = bitmap.width; val height = bitmap.height
        val pixels = IntArray(width * height); bitmap.getPixels(pixels, 0, width, 0, 0, width, height); bitmap.recycle()
        val reader = MultiFormatReader()
        val hints = mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE), DecodeHintType.TRY_HARDER to true, DecodeHintType.CHARACTER_SET to "UTF-8")
        val luminance = RGBLuminanceSource(width, height, pixels)
        val text = try { reader.decode(BinaryBitmap(HybridBinarizer(luminance)), hints).text }
        catch (_: com.google.zxing.NotFoundException) { reader.decode(BinaryBitmap(HybridBinarizer(luminance.invert())), hints).text }
        runOnUiThread { deliver(text) }
      } catch (_: Exception) { runOnUiThread { if (!isDestroyed) status.text = "未识别到二维码，请重新选择图片" } }
    }
  }
  override fun onCreate(state: Bundle?) {
    super.onCreate(state); active = WeakReference(this)
    val dp = resources.displayMetrics.density
    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK) }
    val toolbar = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setBackgroundColor(Color.rgb(121, 85, 72)) }
    toolbar.addView(ImageButton(this).apply { setImageResource(R.drawable.legado_arrow_back); contentDescription = "返回"; setColorFilter(Color.WHITE); setBackgroundColor(Color.TRANSPARENT); setOnClickListener { finish() } }, LinearLayout.LayoutParams((48 * dp).toInt(), (56 * dp).toInt()))
    toolbar.addView(TextView(this).apply { text = "扫描二维码"; textSize = 20f; setTextColor(Color.WHITE) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    toolbar.addView(Button(this).apply { text = "图库"; setTextColor(Color.WHITE); setBackgroundColor(Color.TRANSPARENT); setOnClickListener { selectingImage = true; gallery.launch("image/*") } })
    root.addView(toolbar)
    status = TextView(this).apply { setTextColor(Color.WHITE); gravity = Gravity.CENTER; setPadding(16, 8, 16, 8) }
    root.addView(status)
    camera = DecoratedBarcodeView(this)
    camera.barcodeView.decoderFactory = DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE), null, "UTF-8", 2)
    camera.setStatusText("")
    root.addView(camera, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    setContentView(root)
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom); WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(root)
    camera.decodeContinuous(object : BarcodeCallback {
      override fun barcodeResult(result: BarcodeResult) { if (!selectingImage) deliver(result.text) }
    })
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) permission.launch(Manifest.permission.CAMERA)
  }
  private fun resumeCamera() { if (!completed && !selectingImage && !isFinishing && ::camera.isInitialized && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) try { camera.resume() } catch (_: Exception) { status.text = "无法打开相机，可从图库选择二维码" } }
  private fun deliver(text: String) { if (completed || isFinishing || isDestroyed) return; completed = true; setResult(Activity.RESULT_OK, Intent().putExtra("text", text)); finish() }
  override fun onResume() { super.onResume(); if (::camera.isInitialized && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) resumeCamera() }
  override fun onPause() { if (::camera.isInitialized) camera.pause(); super.onPause() }
  override fun onDestroy() { if (active.get() === this) active.clear(); decoder.shutdownNow(); super.onDestroy() }
}
