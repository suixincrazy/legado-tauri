package com.suixincrazy.legado

import android.app.Activity
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

object BackupDirectory {
  fun execute(activity: Activity, request: JSONObject): JSONObject {
    val uri = Uri.parse(request.getString("directory"))
    val root = DocumentFile.fromTreeUri(activity, uri) ?: error("备份目录不可用，请重新选择")
    val operation = request.getString("action")
    if (operation == "localList") {
      val files = JSONArray()
      root.listFiles().filter { it.isFile && it.name?.startsWith("backup") == true && it.name?.endsWith(".zip") == true }.forEach {
        files.put(JSONObject().put("name", it.name).put("size", it.length()).put("modified", it.lastModified()))
      }
      return JSONObject().put("body", JSONObject().put("directory", root.name).put("files", files).toString()).put("size", 0)
    }
    val name = request.getString("name")
    require(name.isNotBlank() && name != "." && name != ".." && !name.contains('/') && !name.contains('\\')) { "无效的备份文件名" }
    val previous = root.findFile(name)
    if (operation == "localDelete") { check(previous?.delete() == true) { "删除备份失败" }; return JSONObject().put("size", 0).put("body", "") }
    val staged = File(request.getString("staged")).canonicalFile
    val allowed = File(activity.cacheDir, "backup-transfer").canonicalFile
    require(staged.parentFile == allowed) { "无效的临时备份路径" }
    if (operation == "localLoad") {
      require(previous != null && previous.length() <= 512L * 1024 * 1024) { "备份不存在或超过 512 MB" }
      activity.contentResolver.openInputStream(previous.uri)!!.use { input -> staged.outputStream().use { output -> input.copyTo(output) } }
      return JSONObject().put("size", staged.length()).put("body", "")
    }
    require(operation == "localSave")
    val pending = root.createFile("application/zip", ".${staged.name}.tmp") ?: error("无法创建备份文件")
    try {
      activity.contentResolver.openOutputStream(pending.uri, "wt")!!.use { output -> staged.inputStream().use { it.copyTo(output) } }
      check(pending.length() == staged.length()) { "备份写入不完整" }
      if (previous != null) check(previous.delete()) { "无法替换旧备份" }
      check(pending.renameTo(name)) { "备份已写入但重命名失败" }
      return JSONObject().put("size", staged.length()).put("body", pending.uri.toString())
    } catch (error: Throwable) { if (previous?.exists() != false) pending.delete(); throw error }
  }
}
