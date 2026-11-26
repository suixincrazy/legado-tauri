import UIKit
import UniformTypeIdentifiers
import Tauri

final class BackupDirectoryPicker: NSObject, UIDocumentPickerDelegate {
  private let invoke: Invoke
  private let done: () -> Void
  init(invoke: Invoke, done: @escaping () -> Void) { self.invoke = invoke; self.done = done }
  func present(_ host: UIViewController) {
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
    picker.delegate = self
    host.present(picker, animated: true)
  }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    invoke.resolve(["json":"{\"value\":null}"]); done()
  }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    defer { done() }
    guard let url = urls.first else { invoke.resolve(["json":"{\"value\":null}"]); return }
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    do {
      let bookmark = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
      let json = try JSONSerialization.data(withJSONObject: ["value":"bookmark:" + bookmark.base64EncodedString()])
      invoke.resolve(["json":String(decoding:json,as:UTF8.self)])
    } catch { invoke.reject(error.localizedDescription) }
  }
}

enum BackupDirectory {
  static func execute(_ request: [String:Any]) throws -> [String:Any] {
    guard let encoded = request["directory"] as? String, encoded.hasPrefix("bookmark:"), let data = Data(base64Encoded:String(encoded.dropFirst(9))) else { throw failure("备份目录不可用") }
    var stale = false
    let root = try URL(resolvingBookmarkData:data,options:[],relativeTo:nil,bookmarkDataIsStale:&stale)
    let scoped = root.startAccessingSecurityScopedResource()
    defer { if scoped { root.stopAccessingSecurityScopedResource() } }
    let operation = request["action"] as? String ?? ""
    let manager = FileManager.default
    if operation == "localList" {
      let files = try manager.contentsOfDirectory(at:root,includingPropertiesForKeys:[.fileSizeKey,.contentModificationDateKey,.isRegularFileKey]).filter { $0.lastPathComponent.hasPrefix("backup") && $0.pathExtension == "zip" }.compactMap { url -> [String:Any]? in
        guard let value = try? url.resourceValues(forKeys:[.fileSizeKey,.contentModificationDateKey,.isRegularFileKey]), value.isRegularFile == true else { return nil }
        return ["name":url.lastPathComponent,"size":value.fileSize ?? 0,"modified":(value.contentModificationDate?.timeIntervalSince1970 ?? 0)*1000]
      }
      let json = try JSONSerialization.data(withJSONObject:["directory":root.lastPathComponent,"files":files])
      return ["body":String(decoding:json,as:UTF8.self),"size":0]
    }
    guard let name = request["name"] as? String, !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\\") else { throw failure("无效的备份文件名") }
    let target = root.appendingPathComponent(name)
    if operation == "localDelete" { try manager.removeItem(at:target); return ["body":"","size":0] }
    guard let path = request["staged"] as? String else { throw failure("临时备份不存在") }
    let staged = URL(fileURLWithPath:path).resolvingSymlinksInPath()
    let cache = try manager.url(for:.cachesDirectory,in:.userDomainMask,appropriateFor:nil,create:true).appendingPathComponent(Bundle.main.bundleIdentifier ?? "com.suixincrazy.legado").appendingPathComponent("backup-transfer").resolvingSymlinksInPath()
    guard staged.deletingLastPathComponent() == cache else { throw failure("无效的临时备份路径") }
    if operation == "localLoad" {
      let size = try target.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0
      guard size <= 512*1024*1024 else { throw failure("备份超过 512 MB") }
      if manager.fileExists(atPath:staged.path) { try manager.removeItem(at:staged) }
      try manager.copyItem(at:target,to:staged)
      return ["body":"","size":size]
    }
    guard operation == "localSave" else { throw failure("未知的备份操作") }
    let pending = root.appendingPathComponent("." + staged.lastPathComponent + ".tmp")
    defer { try? manager.removeItem(at:pending) }
    try manager.copyItem(at:staged,to:pending)
    let size = try pending.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0
    if manager.fileExists(atPath:target.path) { _ = try manager.replaceItemAt(target,withItemAt:pending) }
    else { try manager.moveItem(at:pending,to:target) }
    return ["body":target.path,"size":size]
  }
  private static func failure(_ text:String) -> NSError { NSError(domain:"BackupDirectory",code:1,userInfo:[NSLocalizedDescriptionKey:text]) }
}
