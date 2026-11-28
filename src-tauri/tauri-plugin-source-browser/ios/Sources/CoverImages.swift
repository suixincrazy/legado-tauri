import Foundation
import Network
import WebKit

final class CoverImages {
  private let monitor = NWPathMonitor()
  private let queue = DispatchQueue(label: "legado.cover.network")
  private weak var web: WKWebView?
  init(web: WKWebView) {
    self.web = web
    monitor.pathUpdateHandler = { [weak self] _ in
      DispatchQueue.main.async { self?.web?.evaluateJavaScript("window.dispatchEvent(new Event('legado-network-change'))") }
    }
    monitor.start(queue: queue)
  }
  deinit { monitor.cancel() }
  func network() -> [String: Bool] {
    let path = monitor.currentPath
    return ["online": path.status == .satisfied, "wifi": path.status == .satisfied && path.usesInterfaceType(.wifi)]
  }
  func load(_ request: [String: Any], completion: @escaping (Result<[String: Any], Error>) -> Void) {
    let onlyWifi = request["onlyWifi"] as? Bool ?? false
    guard let address = request["url"] as? String, let url = URL(string: address), ["http","https"].contains(url.scheme?.lowercased() ?? "") else {
      completion(.failure(NSError(domain: "Cover", code: 1, userInfo: [NSLocalizedDescriptionKey:"Invalid cover URL"]))); return
    }
    let transfer = CoverTransfer(onlyWifi:onlyWifi, wifi:{ [weak self] in self?.network()["wifi"] == true }, completion:completion)
    transfer.start(url)
  }
}

private final class CoverTransfer: NSObject, URLSessionDataDelegate {
  private let onlyWifi: Bool
  private let wifi: () -> Bool
  private let completion: (Result<[String: Any], Error>) -> Void
  private var bytes = Data()
  private var mime = "image/jpeg"
  private var session: URLSession?
  private var task: URLSessionDataTask?
  private var finished = false
  private var redirects = 0
  init(onlyWifi: Bool, wifi: @escaping () -> Bool, completion: @escaping (Result<[String: Any], Error>) -> Void) {
    self.onlyWifi=onlyWifi; self.wifi=wifi; self.completion=completion
  }
  private var allowed: Bool { !onlyWifi || wifi() }
  private func fail(_ reason: String) { finish(.failure(NSError(domain:"Cover",code:1,userInfo:[NSLocalizedDescriptionKey:reason]))) }
  private func finish(_ result: Result<[String: Any], Error>) {
    guard !finished else { return }; finished=true
    task?.cancel(); session?.invalidateAndCancel(); completion(result)
  }
  func start(_ url: URL) {
    guard allowed else { fail("Only WiFi cover loading is enabled"); return }
    let config=URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest=15; config.timeoutIntervalForResource=30
    config.allowsCellularAccess = !onlyWifi
    config.httpCookieStorage=nil; config.urlCache=nil
    session=URLSession(configuration:config,delegate:self,delegateQueue:nil)
    task=session?.dataTask(with:url); task?.resume()
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    redirects+=1
    guard allowed, redirects<=5, ["http","https"].contains(request.url?.scheme?.lowercased() ?? "") else {
      completionHandler(nil); fail("Cover redirect blocked"); return
    }
    completionHandler(request)
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    guard allowed, let http=response as? HTTPURLResponse, (200..<300).contains(http.statusCode), response.expectedContentLength<=4*1024*1024, response.mimeType?.hasPrefix("image/") == true else {
      completionHandler(.cancel); fail("Cover response rejected"); return
    }
    mime=response.mimeType!; completionHandler(.allow)
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard allowed, bytes.count+data.count<=4*1024*1024 else { fail("Cover transfer blocked"); return }
    bytes.append(data)
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error=error { finish(.failure(error)) }
    else if !allowed { fail("Only WiFi cover loading is enabled") }
    else { finish(.success(["mime":mime,"base64":bytes.base64EncodedString()])) }
  }
}
