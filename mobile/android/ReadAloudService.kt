package com.suixincrazy.legado

import android.app.*
import android.content.*
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.*
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

class ReadAloudService : Service() {
  companion object {
    private var instance: ReadAloudService? = null
    private var pending: JSONObject? = null
    private var lastState = JSONObject().put("state", "idle")
    fun command(context: Context, request: JSONObject): Any {
      val action = request.optString("action")
      if (action == "engines") {
        val engines = context.packageManager.queryIntentServices(Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE), 0)
        return JSONArray().also { out -> engines.forEach { out.put(JSONObject().put("id", it.serviceInfo.packageName).put("name", it.loadLabel(context.packageManager).toString())) } }
      }
      if (action == "systemSettings") { context.startActivity(Intent("com.android.settings.TTS_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return JSONObject() }
      if (action == "start" || action == "resume") {
        if (action == "start") lastState = JSONObject().put("state", "loading").put("bookId", request.optString("bookId"))
        pending = request
        context.startForegroundService(Intent(context, ReadAloudService::class.java))
        return instance?.snapshot() ?: lastState
      }
      instance?.apply(request)
      return instance?.snapshot() ?: lastState
    }
  }
  private val handler = Handler(Looper.getMainLooper())
  private var tts: TextToSpeech? = null
  private var ready = false
  private var chunks = JSONArray()
  private var prefs = JSONObject()
  private var bookId = ""
  private var bookName = ""
  private var index = 0
  private var position = 0
  private var generation = 0
  private var engineGeneration = 0
  private var state = "idle"
  private var error = ""
  private var deadline = 0L
  private var stopChapter = -1
  private var chapterCount = 0
  private var wakeLock: PowerManager.WakeLock? = null
  private var interruptionResume = false
  private lateinit var media: MediaSession
  private lateinit var audio: AudioManager
  private lateinit var focus: AudioFocusRequest
  private val timer = Runnable { pause(); deadline = 0L }
  private val noisy = object : BroadcastReceiver() { override fun onReceive(context: Context?, intent: Intent?) { pause() } }
  override fun onCreate() {
    super.onCreate(); instance = this
    getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("read_aloud", "朗读", NotificationManager.IMPORTANCE_LOW))
    audio = getSystemService(AudioManager::class.java)
    focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
      .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      .setOnAudioFocusChangeListener({ change ->
        if (change == AudioManager.AUDIOFOCUS_GAIN) { if (interruptionResume) { interruptionResume = false; speak() } }
        else if (state == "playing" && !prefs.optBoolean("ignoreAudioFocus")) { interruptionResume = change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT; pause() }
      }, handler).build()
    media = MediaSession(this, "LegadoReadAloud")
    @Suppress("DEPRECATION")
    media.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
    media.setSessionActivity(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    media.setCallback(object : MediaSession.Callback() {
      override fun onPlay() { speak() }
      override fun onPause() { pause() }
      override fun onStop() { stopReading() }
      override fun onSkipToNext() { skip(1, prefs.optBoolean("mediaButtonPerNext")) }
      override fun onSkipToPrevious() { skip(-1, prefs.optBoolean("mediaButtonPerNext")) }
    })
    media.isActive = true
    registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(73, notification())
    val request = pending.also { pending = null } ?: JSONObject().put("action", intent?.getStringExtra("action") ?: "status")
    apply(request)
    return START_NOT_STICKY
  }
  override fun onBind(intent: Intent?) = null
  private fun chunk() = chunks.optJSONObject(index)
  fun snapshot(): JSONObject = JSONObject().put("state", state).put("bookId", bookId).put("index", index)
    .put("position", position).put("chapter", chunk()?.optInt("chapter") ?: 0).put("total", chunks.length())
    .put("error", error).put("remaining", if (deadline == 0L) 0 else maxOf(0L, (deadline - SystemClock.elapsedRealtime() + 999) / 1000))
    .put("chapterStop", chapterCount)
  fun apply(request: JSONObject) {
    when (request.optString("action")) {
      "start" -> {
        generation++; tts?.stop(); clearTimer()
        chunks = request.optJSONArray("chunks") ?: JSONArray(); prefs = request.optJSONObject("settings") ?: JSONObject()
        bookId = request.optString("bookId"); bookName = request.optString("bookName"); index = 0; position = chunk()?.optInt("start") ?: 0
        val timer = request.optJSONObject("timer")
        error = ""; state = "loading"; setTimer(timer?.optInt("minutes") ?: prefs.optInt("timer"), timer?.optInt("chapters") ?: 0); initialize()
      }
      "pause" -> pause()
      "resume" -> { if (!ready) { state = "loading"; initialize() } else speak() }
      "stop" -> stopReading()
      "skip" -> skip(request.optInt("direction", 1), request.optBoolean("chapter"))
      "timer" -> setTimer(request.optInt("minutes"), request.optInt("chapters"))
      "settings" -> {
        val updated = request.optJSONObject("settings") ?: JSONObject()
        val changed = updated.optString("engine") != prefs.optString("engine")
        prefs = updated
        if (changed) { state = "loading"; initialize() } else if (state == "playing") speak()
      }
    }
  }
  private fun initialize() {
    ready = false; generation++; engineGeneration++; val token = engineGeneration
    tts?.stop(); tts?.shutdown(); tts = null
    val engine = prefs.optString("engine").ifBlank {
      Settings.Secure.getString(contentResolver, Settings.Secure.TTS_DEFAULT_SYNTH)
        ?: packageManager.queryIntentServices(Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE), 0).firstOrNull()?.serviceInfo?.packageName ?: ""
    }.ifBlank { null }
    tts = TextToSpeech(applicationContext, { result -> handler.post {
      if (token != engineGeneration) return@post
      if (result != TextToSpeech.SUCCESS) { fail("系统没有可用的朗读引擎，请安装文字转语音引擎"); return@post }
      val speech = tts ?: return@post
      ready = true
      val language = speech.setLanguage(Locale.SIMPLIFIED_CHINESE)
      if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) { fail("当前朗读引擎未安装中文语音"); return@post }
      speech.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      speech.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(id: String?) {}
        override fun onDone(id: String?) { handler.post {
          if (id != generation.toString() || state != "playing") return@post
          val next = chunks.optJSONObject(index + 1)
          if (stopChapter >= 0 && (next == null || next.optInt("chapter") >= stopChapter)) { index++; position = chunk()?.optInt("start") ?: 0; pause(); clearTimer(); return@post }
          index++; position = chunk()?.optInt("start") ?: 0; speak()
        } }
        @Deprecated("Legacy callback") override fun onError(id: String?) { onError(id, TextToSpeech.ERROR) }
        override fun onError(id: String?, code: Int) { handler.post { if (id == generation.toString()) fail("系统朗读失败（$code）") } }
        override fun onRangeStart(id: String?, start: Int, end: Int, frame: Int) { handler.post { if (id == generation.toString()) position = utteranceStart + start } }
      })
      if (state == "loading" || state == "playing") speak()
    } }, engine)
  }
  private var utteranceStart = 0
  private fun speak() {
    if (!ready) return
    val current = chunk()
    if (current == null) { state = "ended"; clearTimer(); audio.abandonAudioFocusRequest(focus); publish(); stopForeground(STOP_FOREGROUND_REMOVE); return }
    if (!prefs.optBoolean("ignoreAudioFocus") && audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { fail("无法获取音频播放权限"); return }
    generation++; tts?.stop(); error = ""
    val rate = if (prefs.optBoolean("followSystem", true)) Settings.Secure.getInt(contentResolver, Settings.Secure.TTS_DEFAULT_RATE, 100) / 100f else prefs.optDouble("rate", 1.0).toFloat()
    tts?.setSpeechRate(rate.coerceIn(0.5f, 5f))
    val text = current.optString("text"); val start = current.optInt("start")
    position = position.coerceIn(start, start + text.length); utteranceStart = position
    state = "playing"; publish(); startForeground(73, notification())
    if (tts?.speak(text.substring(position - start), TextToSpeech.QUEUE_FLUSH, null, generation.toString()) == TextToSpeech.ERROR) fail("朗读引擎无法播放此段正文")
  }
  private fun pause() { generation++; tts?.stop(); state = "paused"; publish() }
  private fun skip(direction: Int, chapter: Boolean) {
    var next = index + direction
    if (chapter) {
      val currentChapter = chunk()?.optInt("chapter") ?: 0
      next = -1
      if (direction > 0) { for (i in index + 1 until chunks.length()) if (chunks.getJSONObject(i).optInt("chapter") > currentChapter) { next = i; break } }
      else { for (i in 0 until chunks.length()) if (chunks.getJSONObject(i).optInt("chapter") == currentChapter - 1) { next = i; break } }
    }
    if (next in 0 until chunks.length()) { index = next; position = chunk()?.optInt("start") ?: 0; speak() }
  }
  private fun clearTimer() { handler.removeCallbacks(timer); deadline = 0; stopChapter = -1; chapterCount = 0 }
  private fun setTimer(minutes: Int, chapters: Int) {
    clearTimer(); chapterCount = chapters.coerceAtLeast(0)
    if (chapterCount > 0) stopChapter = (chunk()?.optInt("chapter") ?: 0) + chapterCount
    if (minutes > 0) { val delay = minutes.coerceAtMost(180) * 60000L; deadline = SystemClock.elapsedRealtime() + delay; handler.postDelayed(timer, delay) }
  }
  private fun stopReading() { generation++; tts?.stop(); clearTimer(); state = "idle"; lastState = snapshot(); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
  private fun fail(message: String) { generation++; tts?.stop(); state = "error"; error = message; clearTimer(); publish(); stopForeground(STOP_FOREGROUND_REMOVE) }
  private fun publish() {
    if (state == "playing" && prefs.optBoolean("readAloudWakeLock")) {
      if (wakeLock == null) wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "legado:readAloud")
      if (wakeLock?.isHeld != true) wakeLock?.acquire(6 * 60 * 60 * 1000L)
    } else if (wakeLock?.isHeld == true) wakeLock?.release()
    lastState = snapshot()
    val value = when (state) { "playing" -> PlaybackState.STATE_PLAYING; "paused" -> PlaybackState.STATE_PAUSED; "error" -> PlaybackState.STATE_ERROR; else -> PlaybackState.STATE_STOPPED }
    media.setPlaybackState(PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS).setState(value, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f).build())
    media.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, bookName).putString(MediaMetadata.METADATA_KEY_ARTIST, chunk()?.optString("title") ?: "").build())
    getSystemService(NotificationManager::class.java).notify(73, notification())
  }
  private fun notification(): Notification {
    fun action(name: String, label: String, icon: Int): Notification.Action {
      val intent = Intent(this, ReadAloudService::class.java).putExtra("action", name)
      return Notification.Action.Builder(icon, label, PendingIntent.getService(this, name.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)).build()
    }
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return Notification.Builder(this, "read_aloud").setSmallIcon(R.drawable.ic_launcher4).setContentTitle(bookName.ifBlank { "阅读" }).setContentText(chunk()?.optString("title") ?: "朗读")
      .setContentIntent(open).setOnlyAlertOnce(true).setOngoing(state == "playing").setVisibility(Notification.VISIBILITY_PUBLIC)
      .addAction(action(if (state == "playing") "pause" else "resume", if (state == "playing") "暂停" else "播放", if (state == "playing") android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play))
      .addAction(action("stop", "停止", android.R.drawable.ic_menu_close_clear_cancel))
      .setStyle(Notification.MediaStyle().setMediaSession(media.sessionToken).setShowActionsInCompactView(0, 1)).build()
  }
  override fun onDestroy() { generation++; engineGeneration++; clearTimer(); tts?.stop(); tts?.shutdown(); if (wakeLock?.isHeld == true) wakeLock?.release(); audio.abandonAudioFocusRequest(focus); media.release(); unregisterReceiver(noisy); if (instance === this) instance = null; super.onDestroy() }
}
