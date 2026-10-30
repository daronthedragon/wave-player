import Foundation
import AVFoundation

enum WaveSoundCloud {
    private static func metadataHost(_ url: URL?) -> Bool {
        guard WaveSoundCloudParser.secure(url), let host = url?.host?.lowercased() else { return false }
        return ["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com", "a-v2.sndcdn.com", "api-v2.soundcloud.com"].contains(host)
    }
    private static func fetch(_ url: URL, limit: Int, media: Bool = false) async throws -> Data {
        try Task.checkCancellation()
        let temporary = WaveAudioImport.directory.appendingPathComponent(UUID().uuidString + ".part")
        defer { try? FileManager.default.removeItem(at: temporary) }
        let downloader = WaveDownload(destination: temporary, limit: limit,
                                      hostCheck: media ? WaveSoundCloudParser.mediaURL : metadataHost)
        _ = try await downloader.download(url)
        return try Data(contentsOf: temporary)
    }
    static func retrieve(_ raw: String, token: String) async throws -> [String: Any] {
        guard let pageURL = WaveSoundCloudParser.publicTrackURL(raw) else { throw waveError("Paste a public SoundCloud artist/track link.") }
        try FileManager.default.createDirectory(at: WaveAudioImport.directory, withIntermediateDirectories: true)
        let pageData = try await fetch(pageURL, limit: 4 * 1024 * 1024)
        guard let page = String(data: pageData, encoding: .utf8),
              let hydration = WaveSoundCloudParser.capture("window\\.__sc_hydration\\s*=\\s*(\\[.*?\\]);", page).first,
              let data = hydration.data(using: .utf8),
              let entries = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              let track = entries.first(where: { ($0["hydratable"] as? String) == "sound" })?["data"] as? [String: Any],
              track["sharing"] as? String == "public", track["streamable"] as? Bool == true,
              ["ALLOW", "MONETIZE"].contains(track["policy"] as? String ?? ""),
              let milliseconds = track["duration"] as? Double, milliseconds > 0, milliseconds <= 7_200_000,
              let media = track["media"] as? [String: Any], let transcodings = media["transcodings"] as? [[String: Any]] else {
            throw waveError("SoundCloud did not provide a public playable track. Private, paid and restricted tracks are not imported.")
        }
        let formats = transcodings.filter {
            guard let format = $0["format"] as? [String: Any], format["protocol"] as? String == "hls",
                  ($0["snipped"] as? Bool) == false, ($0["preset"] as? String ?? "").hasPrefix("aac_"),
                  ($0["quality"] as? String ?? "sq") != "hq",
                  let raw = $0["url"] as? String, let url = URL(string: raw), metadataHost(url),
                  url.host == "api-v2.soundcloud.com", !url.path.contains("preview"), !url.path.contains("encrypted") else { return false }
            return true
        }
        guard let chosen = formats.sorted(by: { ($0["preset"] as? String ?? "") < ($1["preset"] as? String ?? "") }).first,
              let endpoint = chosen["url"] as? String else { throw waveError("No supported full-length unencrypted AAC audio is available for this SoundCloud track.") }
        let scripts = WaveSoundCloudParser.capture("<script[^>]+src=\"([^\"]+)\"", page).reversed().filter {
            guard let url = URL(string: $0) else { return false }
            return WaveSoundCloudParser.secure(url) && url.host == "a-v2.sndcdn.com"
        }
        var client: String?
        for rawScript in scripts.prefix(8) {
            if let url = URL(string: rawScript), let bytes = try? await fetch(url, limit: 4 * 1024 * 1024),
               let script = String(data: bytes, encoding: .utf8),
               let found = WaveSoundCloudParser.capture("client_id\\s*:\\s*\"([A-Za-z0-9]{32})\"", script).first {
                client = found; break
            }
            try Task.checkCancellation()
        }
        guard let client, var apiURL = URLComponents(string: endpoint) else { throw waveError("SoundCloud changed its public player. An app update may be needed.") }
        apiURL.queryItems = [URLQueryItem(name: "client_id", value: client)]
        guard let requestURL = apiURL.url else { throw waveError("Invalid SoundCloud media request.") }
        let streamData = try await fetch(requestURL, limit: 1024 * 1024)
        guard let stream = try JSONSerialization.jsonObject(with: streamData) as? [String: Any],
              let rawManifest = stream["url"] as? String, let manifestURL = URL(string: rawManifest), WaveSoundCloudParser.mediaURL(manifestURL) else {
            throw waveError("SoundCloud returned an unsupported streaming address.")
        }
        let manifestData = try await fetch(manifestURL, limit: 1024 * 1024, media: true)
        guard let manifest = String(data: manifestData, encoding: .utf8) else { throw waveError("Invalid SoundCloud playlist.") }
        let playlist = try WaveSoundCloudParser.playlist(manifest)
        guard abs(playlist.duration - milliseconds / 1000) < max(5, milliseconds / 1000 * 0.02) else {
            throw waveError("SoundCloud supplied a preview or incomplete track.")
        }
        let destination = WaveAudioImport.directory.appendingPathComponent(token + ".m4a")
        FileManager.default.createFile(atPath: destination.path, contents: nil)
        do {
            let handle = try FileHandle(forWritingTo: destination)
            do {
                var total = 0
                for url in [playlist.initialization] + playlist.segments {
                    try Task.checkCancellation()
                    let bytes = try await fetch(url, limit: min(4 * 1024 * 1024, waveAudioLimit - total), media: true)
                    guard bytes.count >= 8, total + bytes.count <= waveAudioLimit else { throw waveError("SoundCloud audio exceeds the 64 MB import limit.") }
                    let box = String(data: bytes.subdata(in: 4..<8), encoding: .ascii)
                    guard ["ftyp", "styp", "moof", "sidx"].contains(box ?? "") else { throw waveError("Unsupported SoundCloud audio fragment.") }
                    try handle.write(contentsOf: bytes); total += bytes.count
                }
                try handle.close()
            } catch { try? handle.close(); throw error }
            let asset = AVURLAsset(url: destination)
            let tracks = try await asset.loadTracks(withMediaType: .audio)
            let duration = try await asset.load(.duration).seconds
            guard !tracks.isEmpty, duration.isFinite, duration > 0, duration <= 7200,
                  abs(duration - playlist.duration) < 5 else { throw waveError("The downloaded SoundCloud audio could not be validated.") }
            let size = try destination.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            return ["token": token, "name": String((track["title"] as? String ?? "SoundCloud audio").prefix(120)) + ".m4a", "type": "audio/mp4", "size": size, "duration": duration]
        } catch { try? FileManager.default.removeItem(at: destination); throw error }
    }
}
