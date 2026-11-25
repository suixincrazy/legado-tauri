import AVFoundation
import MediaPlayer
import UIKit

final class ReadAloud: NSObject, AVSpeechSynthesizerDelegate {
  private let speech = AVSpeechSynthesizer()
  private var chunks = [[String: Any]](), settings = [String: Any]()
  private var bookId = "", bookName = "", state = "idle", error = ""
  private var index = 0, position = 0, utteranceStart = 0, chapterCount = 0
  private var stopChapter = -1
  private var utterance: AVSpeechUtterance?
  private var timer: Timer?, deadline: Date?
  private var interrupted = false
  private var chapter: Int { chunks.indices.contains(index) ? chunks[index]["chapter"] as? Int ?? 0 : 0 }
  override init() {
    super.init(); speech.delegate = self
    NotificationCenter.default.addObserver(self, selector: #selector(interruption(_:)), name: AVAudioSession.interruptionNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
    let remote = MPRemoteCommandCenter.shared()
    remote.playCommand.addTarget { [weak self] _ in self?.speak(); return .success }
    remote.pauseCommand.addTarget { [weak self] _ in self?.pause(); return .success }
    remote.stopCommand.addTarget { [weak self] _ in self?.stop(); return .success }
    remote.nextTrackCommand.addTarget { [weak self] _ in self?.skip(1, false); return .success }
    remote.previousTrackCommand.addTarget { [weak self] _ in self?.skip(-1, false); return .success }
  }
  func command(_ request: [String: Any]) -> Any {
    switch request["action"] as? String ?? "status" {
    case "engines": return AVSpeechSynthesisVoice.speechVoices().map { ["id": $0.identifier, "name": $0.name, "language": $0.language] }
    case "start":
      utterance = nil; speech.stopSpeaking(at: .immediate); clearTimer()
      chunks = request["chunks"] as? [[String: Any]] ?? []; settings = request["settings"] as? [String: Any] ?? [:]
      bookId = request["bookId"] as? String ?? ""; bookName = request["bookName"] as? String ?? ""; index = 0
      position = chunks.first?["start"] as? Int ?? 0; error = ""
      setTimer(settings["timer"] as? Int ?? 0, 0); speak()
    case "pause": pause()
    case "resume": speak()
    case "stop": stop()
    case "skip": skip(request["direction"] as? Int ?? 1, request["chapter"] as? Bool ?? false)
    case "timer": setTimer(request["minutes"] as? Int ?? 0, request["chapters"] as? Int ?? 0)
    case "settings": settings = request["settings"] as? [String: Any] ?? settings; if state == "playing" { speak() }
    default: break
    }
    return snapshot()
  }
  func snapshot() -> [String: Any] {
    ["state": state, "bookId": bookId, "index": index, "position": position, "chapter": chapter, "total": chunks.count, "error": error, "remaining": max(0, Int(ceil(deadline?.timeIntervalSinceNow ?? 0))), "chapterStop": chapterCount]
  }
  private func speak() {
    guard chunks.indices.contains(index) else { state = "ended"; clearTimer(); publish(); deactivate(); return }
    do { try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio); try AVAudioSession.sharedInstance().setActive(true) }
    catch { state = "error"; self.error = "无法启用系统朗读：\(error.localizedDescription)"; return }
    utterance = nil; speech.stopSpeaking(at: .immediate)
    let item = chunks[index], text = (item["text"] as? String ?? "") as NSString, start = item["start"] as? Int ?? 0
    position = max(start, min(start + text.length, position)); utteranceStart = position
    let value = AVSpeechUtterance(string: text.substring(from: position - start))
    let voiceId = settings["engine"] as? String ?? ""
    value.voice = voiceId.isEmpty ? AVSpeechSynthesisVoice(language: "zh-CN") : AVSpeechSynthesisVoice(identifier: voiceId)
    let rate: Double = (settings["followSystem"] as? Bool ?? true) ? 1 : (settings["rate"] as? Double ?? 1)
    value.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * Float(rate)))
    utterance = value; state = "playing"; error = ""; publish(); speech.speak(value)
  }
  private func pause() { utterance = nil; speech.stopSpeaking(at: .immediate); state = "paused"; publish() }
  private func stop() { utterance = nil; speech.stopSpeaking(at: .immediate); state = "idle"; chunks = []; clearTimer(); MPNowPlayingInfoCenter.default().nowPlayingInfo = nil; deactivate() }
  private func deactivate() { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
  private func skip(_ direction: Int, _ byChapter: Bool) {
    let next = byChapter ? chunks.firstIndex { (($0["chapter"] as? Int ?? 0) == chapter - 1 && direction < 0) || (($0["chapter"] as? Int ?? 0) > chapter && direction > 0) } : index + direction
    guard let next = next, chunks.indices.contains(next) else { return }
    index = next; position = chunks[index]["start"] as? Int ?? 0; speak()
  }
  private func clearTimer() { timer?.invalidate(); timer = nil; deadline = nil; stopChapter = -1; chapterCount = 0 }
  private func setTimer(_ minutes: Int, _ chapters: Int) {
    clearTimer(); chapterCount = max(0, chapters); if chapters > 0 { stopChapter = chapter + chapters }
    if minutes > 0 { let duration = Double(min(180, minutes) * 60); deadline = Date().addingTimeInterval(duration); timer = Timer.scheduledTimer(withTimeInterval: duration, repeats: false) { [weak self] _ in self?.pause(); self?.clearTimer() } }
  }
  private func publish() {
    MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle: bookName, MPMediaItemPropertyArtist: chunks.indices.contains(index) ? chunks[index]["title"] as? String ?? "" : "", MPNowPlayingInfoPropertyPlaybackRate: state == "playing" ? 1.0 : 0.0, MPNowPlayingInfoPropertyIsLiveStream: true]
  }
  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
    guard utterance === self.utterance else { return }; position = utteranceStart + characterRange.location
  }
  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    guard utterance === self.utterance, state == "playing" else { return }
    let next = index + 1
    if stopChapter >= 0 && (!chunks.indices.contains(next) || (chunks[next]["chapter"] as? Int ?? 0) >= stopChapter) { pause(); clearTimer(); return }
    index = next; position = chunks.indices.contains(index) ? chunks[index]["start"] as? Int ?? 0 : 0; speak()
  }
  @objc private func interruption(_ notification: Notification) {
    guard let kind = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else { return }
    if kind == AVAudioSession.InterruptionType.began.rawValue { interrupted = state == "playing"; if interrupted { pause() } }
    else { let options = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0; if interrupted && AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume) { speak() }; interrupted = false }
  }
  @objc private func routeChanged(_ notification: Notification) { if notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue && state == "playing" { pause() } }
}
