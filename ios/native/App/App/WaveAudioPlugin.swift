import Foundation
import Capacitor
import YouTubeKit
import AVFoundation

private let waveAudioLimit = 64 * 1024 * 1024
private func waveError(_ message: String) -> NSError {
    NSError(domain: "WAVEAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

// Download to disk, enforcing the byte limit while receiving data, including redirects.
private final class WaveDownload: NSObject, URLSessionDownloadDelegate {
    private var continuation: CheckedContinuation<URL, Error>?
    private var session: URLSession?
    private var task: URLSessionDownloadTask?
    private var result: Result<URL, Error>?
    private let destination: URL
    init(destination: URL) { self.destination = destination }
    static func allowed(_ url: URL?) -> Bool {
        guard let url, url.scheme == "https", url.user == nil, url.password == nil,
              url.port == nil || url.port == 443, let host = url.host?.lowercased() else { return false }
        return host == "googlevideo.com" || host.hasSuffix(".googlevideo.com")
    }
    func download(_ url: URL) async throws -> URL {
        guard Self.allowed(url) else { throw waveError("YouTube returned an unsupported media address.") }
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                let configuration = URLSessionConfiguration.ephemeral
                configuration.timeoutIntervalForRequest = 45
                configuration.timeoutIntervalForResource = 150
                let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
                self.session = session
                var request = URLRequest(url: url)
                request.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
                self.task = session.downloadTask(with: request)
                self.task?.resume()
            }
        }, onCancel: { self.task?.cancel() })
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(Self.allowed(request.url) ? request : nil)
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesWritten > waveAudioLimit || totalBytesExpectedToWrite > waveAudioLimit {
            result = .failure(waveError("Audio exceeds WAVE's 64 MB import limit."))
            downloadTask.cancel()
        }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        do {
            guard let response = downloadTask.response as? HTTPURLResponse, response.statusCode == 200,
                  Self.allowed(response.url) else { throw waveError("YouTube declined the audio download. Try another public track.") }
            let size = try location.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size > 0 && size <= waveAudioLimit else { throw waveError("Audio is empty or exceeds the 64 MB limit.") }
            try FileManager.default.moveItem(at: location, to: destination)
            result = .success(destination)
        } catch { result = .failure(error) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let outcome = result ?? .failure(error ?? waveError("Audio download did not complete."))
        continuation?.resume(with: outcome)
        continuation = nil
        session.finishTasksAndInvalidate()
        self.session = nil
        self.task = nil
    }
}

private enum WaveAudioImport {
    static var directory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("wave-import", isDirectory: true)
    }
    static func videoID(_ raw: String) throws -> String {
        guard raw.count <= 2048, let url = URL(string: raw), url.scheme == "https", url.user == nil,
              url.password == nil, url.port == nil, let host = url.host?.lowercased() else {
            throw waveError("Paste a public HTTPS YouTube video link.")
        }
        let parts = url.path.split(separator: "/").map(String.init)
        var id: String?
        if host == "youtu.be", parts.count == 1 { id = parts[0] }
        else if ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].contains(host) {
            if url.path == "/watch" {
                id = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "v" })?.value
            } else if parts.count == 2, ["shorts", "live", "embed"].contains(parts[0]) { id = parts[1] }
        }
        guard let id, id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else {
            throw waveError("The iPhone importer currently supports individual YouTube videos only.")
        }
        return id
    }
    static func retrieve(_ raw: String, token: String) async throws -> [String: Any] {
        let id = try videoID(raw)
        try Task.checkCancellation()
        // Explicitly local: never invoke YouTubeKit's optional hosted fallback.
        let video = YouTube(videoID: id, methods: [.local])
        let streams = try await video.streams
        try Task.checkCancellation()
        guard let stream = streams.filterAudioOnly().filter({ $0.fileExtension == .m4a }).highestAudioBitrateStream() else {
            throw waveError("YouTube did not provide an available audio-only M4A stream.")
        }
        let metadata = try? await video.metadata
        let title = metadata?.title ?? "YouTube \(id)"
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appendingPathComponent(token + ".m4a")
        do {
            let downloader = WaveDownload(destination: destination)
            let file = try await downloader.download(stream.url)
            try Task.checkCancellation()
            let asset = AVURLAsset(url: file)
            let tracks = try await asset.loadTracks(withMediaType: .audio)
            let duration = try await asset.load(.duration).seconds
            guard !tracks.isEmpty, duration.isFinite, duration > 0, duration <= 7200 else {
                throw waveError("Downloaded audio is invalid or longer than two hours.")
            }
            let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            return ["token": token, "name": String(title.prefix(120)) + ".m4a", "type": "audio/mp4", "size": size, "duration": duration]
        } catch {
            try? FileManager.default.removeItem(at: destination)
            throw error
        }
    }
}

@objc(WaveAudioPlugin)
public class WaveAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WaveAudioPlugin"
    public let jsName = "WaveAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "importAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cleanup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]
    private var active: Task<Void, Never>?
    private var activeToken: String?
    private var files: Set<String> = []
    private func trusted() -> Bool {
        bridge?.webView?.url?.scheme == "capacitor" && bridge?.webView?.url?.host == "localhost"
    }
    @objc func importAudio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.trusted(), self.active == nil, let raw = call.getString("url"),
                  let token = call.getString("token"), UUID(uuidString: token) != nil else {
                call.reject("Audio import is unavailable or another import is running."); return
            }
            self.activeToken = token
            self.active = Task { @MainActor in
                defer { self.active = nil; self.activeToken = nil }
                do {
                    let result = try await WaveAudioImport.retrieve(raw, token: token)
                    self.files.insert(token)
                    call.resolve(result)
                } catch {
                    call.reject(Task.isCancelled ? "Audio import cancelled." : "YouTube audio import failed: \(error.localizedDescription)")
                }
            }
        }
    }
    @objc func readChunk(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.trusted(), let token = call.getString("token"), self.files.contains(token),
                  let offset = call.getInt("offset"), offset >= 0, offset <= waveAudioLimit else {
                call.reject("Invalid audio cache request."); return
            }
            do {
                let handle = try FileHandle(forReadingFrom: WaveAudioImport.directory.appendingPathComponent(token + ".m4a"))
                defer { try? handle.close() }
                try handle.seek(toOffset: UInt64(offset))
                let data = try handle.read(upToCount: 256 * 1024) ?? Data()
                call.resolve(["data": data.base64EncodedString()])
            } catch { call.reject("Cannot read downloaded audio.") }
        }
    }
    @objc func cleanup(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.trusted(), let token = call.getString("token"), self.files.remove(token) != nil {
                try? FileManager.default.removeItem(at: WaveAudioImport.directory.appendingPathComponent(token + ".m4a"))
            }
            call.resolve()
        }
    }
    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.trusted(), call.getString("token") == self.activeToken { self.active?.cancel() }
            call.resolve()
        }
    }
}

class WaveBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WaveAudioPlugin())
        #if DEBUG
        // Only CI/developers explicitly launching this argument perform a live provider probe.
        if ProcessInfo.processInfo.arguments.contains("-wave-audio-diagnostic") {
            Task { @MainActor in
                let token = UUID().uuidString
                var result: [String: Any]
                do {
                    result = try await WaveAudioImport.retrieve("https://www.youtube.com/watch?v=jNQXAC9IVRw", token: token)
                    result.removeValue(forKey: "name")
                    result.removeValue(forKey: "token")
                    result["status"] = "passed"
                } catch { result = ["status": "provider-failed", "error": error.localizedDescription] }
                try? FileManager.default.removeItem(at: WaveAudioImport.directory.appendingPathComponent(token + ".m4a"))
                let output = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("wave-ios-diagnostic.json")
                if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted]) { try? data.write(to: output) }
            }
        }
        #endif
    }
}
