import UIKit
import AVFoundation
import PhotosUI
import Vision

class QrScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate, PHPickerViewControllerDelegate {
  private let completion: (String?) -> Void
  private let session = AVCaptureSession(), queue = DispatchQueue(label: "legado.qr.camera")
  private let preview = UIView(), status = UILabel()
  private var layer: AVCaptureVideoPreviewLayer?
  private var configured = false, finished = false, selectingImage = false
  init(completion: @escaping (String?) -> Void) { self.completion = completion; super.init(nibName: nil, bundle: nil) }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func viewDidLoad() {
    super.viewDidLoad(); view.backgroundColor = .black
    let bar = UIView(); bar.backgroundColor = UIColor(red: 121/255, green: 85/255, blue: 72/255, alpha: 1)
    let back = UIButton(type: .system); back.setImage(UIImage(systemName: "arrow.left"), for: .normal); back.accessibilityLabel = "返回"; back.tintColor = .white; back.addTarget(self, action: #selector(cancel), for: .touchUpInside)
    let title = UILabel(); title.text = "扫描二维码"; title.textColor = .white; title.font = .systemFont(ofSize: 20)
    let album = UIButton(type: .system); album.setTitle("图库", for: .normal); album.tintColor = .white; album.addTarget(self, action: #selector(gallery), for: .touchUpInside)
    let row = UIStackView(arrangedSubviews: [back, title, album]); row.axis = .horizontal; row.spacing = 8; row.alignment = .center
    for item in [bar, preview, status, row] { item.translatesAutoresizingMaskIntoConstraints = false }
    view.addSubview(bar); bar.addSubview(row); view.addSubview(preview); view.addSubview(status)
    status.textColor = .white; status.numberOfLines = 0; status.textAlignment = .center
    NSLayoutConstraint.activate([
      bar.leadingAnchor.constraint(equalTo: view.leadingAnchor), bar.trailingAnchor.constraint(equalTo: view.trailingAnchor), bar.topAnchor.constraint(equalTo: view.topAnchor), bar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 56),
      row.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor), row.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16), row.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), row.heightAnchor.constraint(equalToConstant: 56), back.widthAnchor.constraint(equalToConstant: 48), back.heightAnchor.constraint(equalToConstant: 48), album.widthAnchor.constraint(equalToConstant: 56),
      preview.topAnchor.constraint(equalTo: bar.bottomAnchor), preview.leadingAnchor.constraint(equalTo: view.leadingAnchor), preview.trailingAnchor.constraint(equalTo: view.trailingAnchor), preview.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
      status.centerYAnchor.constraint(equalTo: preview.centerYAnchor), status.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24), status.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24)
    ])
    layer = AVCaptureVideoPreviewLayer(session: session); layer?.videoGravity = .resizeAspectFill
    if let layer = layer { preview.layer.addSublayer(layer) }
  }
  override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); if !selectingImage { authorize() } }
  override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); queue.async { [session] in if session.isRunning { session.stopRunning() } } }
  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews(); layer?.frame = preview.bounds
    if let orientation = view.window?.windowScene?.interfaceOrientation, let connection = layer?.connection, connection.isVideoOrientationSupported {
      switch orientation {
      case .landscapeLeft: connection.videoOrientation = .landscapeLeft
      case .landscapeRight: connection.videoOrientation = .landscapeRight
      case .portraitUpsideDown: connection.videoOrientation = .portraitUpsideDown
      default: connection.videoOrientation = .portrait
      }
    }
  }
  private func authorize() {
    guard !finished else { return }
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: start()
    case .notDetermined: AVCaptureDevice.requestAccess(for: .video) { [weak self] _ in DispatchQueue.main.async { self?.authorize() } }
    default: status.text = "相机权限未开启，可从图库选择二维码"
    }
  }
  private func start() {
    status.text = nil
    queue.async { [weak self] in
      guard let self = self else { return }
      do {
        if !self.configured {
          guard let device = AVCaptureDevice.default(for: .video) else { throw NSError(domain: "Camera", code: 1) }
          let input = try AVCaptureDeviceInput(device: device), output = AVCaptureMetadataOutput()
          guard self.session.canAddInput(input), self.session.canAddOutput(output) else { throw NSError(domain: "Camera", code: 2) }
          self.session.beginConfiguration(); self.session.addInput(input); self.session.addOutput(output)
          output.setMetadataObjectsDelegate(self, queue: .main); output.metadataObjectTypes = [.qr]
          self.session.commitConfiguration(); self.configured = true
        }
        if !self.session.isRunning { self.session.startRunning() }
      } catch { DispatchQueue.main.async { self.status.text = "无法打开相机，可从图库选择二维码" } }
    }
  }
  func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
    if !selectingImage, presentedViewController == nil, let value = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue { finish(value) }
  }
  @objc private func cancel() { finish(nil) }
  func finish(_ text: String?) {
    guard !finished else { return }; finished = true
    queue.async { [session] in if session.isRunning { session.stopRunning() } }
    dismiss(animated: true) { self.completion(text) }
  }
  @objc private func gallery() {
    selectingImage = true
    queue.async { [session] in if session.isRunning { session.stopRunning() } }
    var options = PHPickerConfiguration(); options.filter = .images; options.selectionLimit = 1
    let picker = PHPickerViewController(configuration: options); picker.delegate = self; present(picker, animated: true)
  }
  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true) { [weak self] in self?.decodeSelection(results) }
  }
  private func decodeSelection(_ results: [PHPickerResult]) {
    guard !finished else { return }
    guard let provider = results.first?.itemProvider else { selectingImage = false; authorize(); return }
    provider.loadObject(ofClass: UIImage.self) { [weak self] item, _ in
      guard let self = self else { return }
      guard let image = item as? UIImage else { DispatchQueue.main.async { self.status.text = "无法读取图片" }; return }
      let scale = min(1, 2048 / max(image.size.width, image.size.height)), size = CGSize(width: max(1, image.size.width * scale), height: max(1, image.size.height * scale))
      let format = UIGraphicsImageRendererFormat(); format.scale = 1
      let normalized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
      guard let cgImage = normalized.cgImage else { return }
      let request = VNDetectBarcodesRequest(); request.symbologies = [.qr]
      try? VNImageRequestHandler(cgImage: cgImage).perform([request])
      let text = request.results?.first?.payloadStringValue
      DispatchQueue.main.async {
        guard !self.finished else { return }
        if let text = text { self.finish(text) } else { self.status.text = "未识别到二维码，请重新选择图片" }
      }
    }
  }
}
