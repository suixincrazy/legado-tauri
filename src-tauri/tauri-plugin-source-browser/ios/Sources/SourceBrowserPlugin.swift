import Tauri
import UIKit
import WebKit

struct BrowserArgs: Decodable { let payload: String }
class SourceBrowserPlugin: Plugin {
  private var browser: SourceBrowserController?
  private var readerBrightness: CGFloat?
  private var sharing = false
  private var scanner: QrScannerController?
  private var backupPicker: BackupDirectoryPicker?
  private lazy var readAloud = ReadAloud()
  @objc public func open(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(BrowserArgs.self)
    guard let data = args.payload.data(using: .utf8), let request = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { invoke.reject("Invalid browser request"); return }
    DispatchQueue.main.async {
      if request["mode"] as? String == "backupDirectory" {
        if request["action"] as? String == "pick" {
          guard self.backupPicker == nil, let host = self.manager.viewController else { invoke.reject("目录选择窗口已经打开"); return }
          let picker = BackupDirectoryPicker(invoke:invoke) { self.backupPicker = nil }
          self.backupPicker = picker; picker.present(host)
        } else {
          DispatchQueue.global(qos:.userInitiated).async {
            do { let result = try BackupDirectory.execute(request); let data = try JSONSerialization.data(withJSONObject:result); invoke.resolve(["json":String(decoding:data,as:UTF8.self)]) }
            catch { invoke.reject(error.localizedDescription) }
          }
        }
        return
      }
      if request["mode"] as? String == "qrCancel" {
        self.scanner?.finish(nil)
        invoke.resolve(["json": "{\"value\":null}"]); return
      }
      if request["mode"] as? String == "qrScan" {
        guard self.scanner == nil, let host = self.manager.viewController else { invoke.reject("扫描窗口已经打开"); return }
        let scanner = QrScannerController { text in
          self.scanner = nil
          let value: Any = text.map { $0 as Any } ?? NSNull()
          if let bytes = try? JSONSerialization.data(withJSONObject: ["value": value]), let json = String(data: bytes, encoding: .utf8) { invoke.resolve(["json": json]) }
          else { invoke.reject("Invalid QR result") }
        }
        self.scanner = scanner; scanner.modalPresentationStyle = .fullScreen
        host.present(scanner, animated: true); return
      }
      if request["mode"] as? String == "share" {
        guard !self.sharing else { invoke.reject("分享窗口已经打开"); return }
        guard let host = self.manager.viewController else { invoke.reject("无法打开分享窗口"); return }
        let text = request["text"] as? String ?? ""
        var item: Any = text, directory: URL?
        do {
          if let name = request["name"] as? String {
            guard !name.isEmpty && name != "." && name != ".." && !name.contains("/") && !name.contains("\\") else { invoke.reject("Invalid share filename"); return }
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("legado-share-" + UUID().uuidString, isDirectory: true)
            directory = folder
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let file = folder.appendingPathComponent(name)
            let bytes: Data
            if let encoded = request["base64"] as? String {
              guard let decoded = Data(base64Encoded: encoded) else { throw NSError(domain: "Share", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid share data"]) }
              bytes = decoded
            } else { bytes = Data(text.utf8) }
            try bytes.write(to: file, options: .atomic)
            item = file
          }
          let sheet = UIActivityViewController(activityItems: [item], applicationActivities: nil)
          sheet.setValue(request["title"] as? String ?? "分享", forKey: "subject")
          if let popover = sheet.popoverPresentationController {
            popover.sourceView = host.view
            popover.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
          }
          sheet.completionWithItemsHandler = { _, completed, _, error in
            if let folder = directory { try? FileManager.default.removeItem(at: folder) }
            self.sharing = false
            if let error = error { invoke.reject(error.localizedDescription) }
            else { invoke.resolve(["json": completed ? "{\"value\":true}" : "{\"value\":false}"]) }
          }
          self.sharing = true
          host.present(sheet, animated: true)
        } catch {
          if let folder = directory { try? FileManager.default.removeItem(at: folder) }
          invoke.reject(error.localizedDescription)
        }
        return
      }
      if request["mode"] as? String == "clipboard" {
        let value: String
        switch request["action"] as? String {
        case "read": value = UIPasteboard.general.string ?? ""
        case "write": UIPasteboard.general.string = request["text"] as? String ?? ""; value = ""
        default: invoke.reject("Invalid clipboard action"); return
        }
        if let bytes = try? JSONSerialization.data(withJSONObject: ["value": value]), let json = String(data: bytes, encoding: .utf8) { invoke.resolve(["json": json]) }
        else { invoke.reject("Invalid clipboard response") }
        return
      }
      if request["mode"] as? String == "readAloud" {
        let result = self.readAloud.command(request)
        if let bytes = try? JSONSerialization.data(withJSONObject: result), let json = String(data: bytes, encoding: .utf8) { invoke.resolve(["json": json]) }
        else { invoke.reject("Invalid read aloud response") }
        return
      }
      if request["mode"] as? String == "readerScreen" {
        let active = request["active"] as? Bool ?? false
        UIApplication.shared.isIdleTimerDisabled = active && (request["keepScreenOn"] as? Bool ?? false)
        if active && self.readerBrightness == nil { self.readerBrightness = UIScreen.main.brightness }
        let brightness = request["brightness"] as? Double ?? -1
        if active && brightness >= 0 { UIScreen.main.brightness = CGFloat(min(1, max(0.01, brightness))) }
        else if let previous = self.readerBrightness { UIScreen.main.brightness = previous }
        if !active { self.readerBrightness = nil }
        if #available(iOS 16.0, *), let scene = self.manager.viewController?.view.window?.windowScene {
          let orientation = request["orientation"] as? String ?? "auto"
          let mask: UIInterfaceOrientationMask = !active || orientation == "auto" ? .all : orientation == "portrait" ? .portrait : .landscape
          scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
        }
        invoke.resolve(["json": "{}"])
        return
      }
      if request["mode"] as? String == "clearCookies" {
        let hosts = (request["urls"] as? [String] ?? []).compactMap { URL(string: $0)?.host }
        let store = WKWebsiteDataStore.default().httpCookieStore
        store.getAllCookies { cookies in
          let group = DispatchGroup()
          for cookie in cookies {
            let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
            if hosts.contains(where: { $0 == domain || $0.hasSuffix("." + domain) }) { group.enter(); store.delete(cookie) { group.leave() } }
          }
          group.notify(queue: .main) { invoke.resolve(["json": "{\"value\":\"\"}"]) }
        }
        return
      }
      guard self.browser == nil else { invoke.reject("已有书源网页正在打开"); return }
      guard let host = self.manager.viewController else { invoke.reject("无法打开书源窗口"); return }
      let browser = SourceBrowserController(request: request) { result in
        guard let bytes = try? JSONSerialization.data(withJSONObject: result), let json = String(data: bytes, encoding: .utf8) else { invoke.reject("Invalid browser response"); return }
        self.browser = nil; invoke.resolve(["json": json])
      }
      self.browser = browser
      browser.modalPresentationStyle = .fullScreen
      host.present(browser, animated: true)
    }
  }
}

class SourceBrowserController: UIViewController, WKNavigationDelegate, WKUIDelegate {
  private let request: [String: Any]
  private let completion: ([String: Any]) -> Void
  private var web: WKWebView!
  private let status = UILabel(), address = UILabel(), code = UITextField(), progress = UIProgressView(progressViewStyle: .default)
  private var observation: NSKeyValueObservation?, timeout: DispatchWorkItem?
  private var finished = false, pageFailed = false, visited = Set<String>()
  private var originalURL: URL?
  private var desktop = false, mobileAgent: String?
  init(request: [String: Any], completion: @escaping ([String: Any]) -> Void) { self.request = request; self.completion = completion; super.init(nibName: nil, bundle: nil) }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func viewDidLoad() {
    super.viewDidLoad(); view.backgroundColor = .systemBackground
    guard let text = request["url"] as? String, let url = URL(string: text), ["http", "https"].contains(url.scheme ?? "") else { finish(["error": "浏览器地址必须为 HTTP(S)"]); return }
    originalURL = url; visited.insert(url.absoluteString)
    let config = WKWebViewConfiguration(); config.websiteDataStore = .default()
    if let script = request["preloadJs"] as? String { config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: true)) }
    web = WKWebView(frame: .zero, configuration: config); web.navigationDelegate = self; web.uiDelegate = self
    let toolbar = UIStackView(); toolbar.axis = .horizontal; toolbar.distribution = .fillEqually
    for (title, selector) in [("关闭", #selector(cancel)), ("后退", #selector(back)), ("刷新", #selector(reload)), ("电脑版", #selector(toggleDesktop(_:))), ("完成", #selector(capture))] { let button = UIButton(type: .system); button.setTitle(title, for: .normal); button.addTarget(self, action: selector, for: .touchUpInside); toolbar.addArrangedSubview(button) }
    address.text = request["title"] as? String ?? "书源网页登录"; address.font = .preferredFont(forTextStyle: .headline); address.numberOfLines = 2
    status.font = .preferredFont(forTextStyle: .footnote); status.numberOfLines = 3
    code.placeholder = "输入验证码"; code.borderStyle = .roundedRect; code.isHidden = request["mode"] as? String != "code"
    let stack = UIStackView(arrangedSubviews: [toolbar, address, progress, status, web, code]); stack.axis = .vertical; stack.spacing = 6; stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 10), stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -10), stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8), toolbar.heightAnchor.constraint(equalToConstant: 44)])
    web.setContentHuggingPriority(.defaultLow, for: .vertical)
    observation = web.observe(\.estimatedProgress, options: [.new]) { [weak self] web, _ in self?.progress.progress = Float(web.estimatedProgress) }
    let headers = request["headers"] as? [String: String] ?? [:]
    if let ua = headers.first(where: { $0.key.lowercased() == "user-agent" })?.value { web.customUserAgent = ua }
    mobileAgent = web.customUserAgent
    let group = DispatchGroup()
    if let cookies = headers.first(where: { $0.key.lowercased() == "cookie" })?.value {
      for pair in cookies.split(separator: ";") {
        let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
        if parts.count == 2, let cookie = HTTPCookie(properties: [.domain: url.host ?? "", .path: "/", .name: parts[0].trimmingCharacters(in: .whitespaces), .value: parts[1], .secure: url.scheme == "https" ? "TRUE" : "FALSE"]) { group.enter(); web.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { group.leave() } }
      }
    }
    group.notify(queue: .main) { [weak self] in self?.loadOriginal() }
    let item = DispatchWorkItem { [weak self] in self?.finish(["error": "书源浏览器等待超时"]) }; timeout = item
    DispatchQueue.main.asyncAfter(deadline: .now() + (request["mode"] as? String == "render" ? 30 : 300), execute: item)
  }
  private func loadOriginal() {
    guard let url = originalURL else { return }; pageFailed = false; status.text = "正在加载…"
    if let html = request["html"] as? String { web.loadHTMLString(html, baseURL: url) }
    else { var req = URLRequest(url: url); for (key, value) in request["headers"] as? [String: String] ?? [:] { if key.lowercased() != "user-agent" { req.setValue(value, forHTTPHeaderField: key) } }; web.load(req) }
  }
  @objc private func cancel() { finish(["error": "已取消书源验证"]) }
  @objc private func back() { if web.canGoBack { web.goBack() } }
  @objc private func reload() { pageFailed = false; if web.url != nil { web.reload() } else { loadOriginal() } }
  @objc private func toggleDesktop(_ button: UIButton) { desktop.toggle(); button.setTitle(desktop ? "手机版" : "电脑版", for: .normal); web.customUserAgent = desktop ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" : mobileAgent; loadOriginal() }
  @objc private func capture() {
    if request["mode"] as? String == "code" { finish(["value": code.text ?? ""]); return }
    guard !pageFailed else { status.text = "网页尚未加载成功，请刷新重试。"; return }
    web.evaluateJavaScript(request["js"] as? String ?? "document.documentElement.outerHTML") { [weak self] value, error in
      guard let self = self, !self.finished else { return }
      if error != nil { self.status.text = "页面脚本执行失败，请刷新重试。"; return }
      let final = self.web.url ?? self.originalURL!
      self.web.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
        var stored: [String: String] = [:]
        for text in self.visited.union([final.absoluteString]) {
          guard let url = URL(string: text), let host = url.host else { continue }
          let matched = cookies.filter { c in let domain = c.domain.hasPrefix(".") ? String(c.domain.dropFirst()) : c.domain; return (host == domain || host.hasSuffix("." + domain)) && url.path.hasPrefix(c.path) && (!c.isSecure || url.scheme == "https") }
          stored[text] = matched.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
        }
        DispatchQueue.main.async { self.finish(["value": ["url": final.absoluteString, "body": value.map { String(describing: $0) } ?? "", "status": 200, "cookie": stored[final.absoluteString] ?? "", "cookies": stored]]) }
      }
    }
  }
  private func finish(_ result: [String: Any]) { guard !finished else { return }; finished = true; timeout?.cancel(); observation?.invalidate(); web?.stopLoading(); if presentingViewController != nil { dismiss(animated: true) { self.completion(result) } } else { completion(result) } }
  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { pageFailed = false; status.text = "正在加载…" }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if let url = webView.url { visited.insert(url.absoluteString) }; if !pageFailed { status.text = "页面已加载，登录后点击完成。" }
    if request["mode"] as? String == "render" && !pageFailed { DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.capture() } }
  }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
  private func failed(_ error: Error) { let e = error as NSError; if e.code == NSURLErrorCancelled { return }; pageFailed = true; status.text = "网页加载失败（\(e.code)）。请检查网络或代理后刷新。"; if request["mode"] as? String == "render" { finish(["error": status.text!]) } }
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) { let scheme = action.request.url?.scheme ?? ""; decisionHandler(["http", "https", "about"].contains(scheme) ? .allow : .cancel) }
  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    if response.isForMainFrame, let http = response.response as? HTTPURLResponse, http.statusCode >= 400 { pageFailed = true; status.text = "网页返回 HTTP \(http.statusCode)，请稍后重试。"; if request["mode"] as? String == "render" { finish(["error": status.text!]) } }
    decisionHandler(.allow)
  }
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { if action.targetFrame == nil, let scheme = action.request.url?.scheme, ["http", "https"].contains(scheme) { webView.load(action.request) }; return nil }
}
@_cdecl("init_plugin_source_browser")
public func initPlugin() -> Plugin { SourceBrowserPlugin() }
