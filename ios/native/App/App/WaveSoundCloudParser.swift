import Foundation

enum WaveSoundCloudParser {
    struct Playlist {
        let initialization: URL
        let segments: [URL]
        let duration: Double
    }
    static func capture(_ pattern: String, _ input: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]) else { return [] }
        return regex.matches(in: input, range: NSRange(input.startIndex..., in: input)).compactMap {
            guard $0.numberOfRanges > 1, let range = Range($0.range(at: 1), in: input) else { return nil }
            return String(input[range])
        }
    }
    static func secure(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == "https" && url.user == nil && url.password == nil && url.port == nil
    }
    static func mediaURL(_ url: URL?) -> Bool {
        secure(url) && url?.host?.lowercased() == "playback.media-streaming.soundcloud.cloud"
    }
    static func publicTrackURL(_ raw: String) -> URL? {
        guard raw.count <= 2048, let url = URL(string: raw), secure(url),
              ["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"].contains(url.host?.lowercased() ?? "") else { return nil }
        let parts = url.path.split(separator: "/")
        guard parts.count == 2, !["sets", "tracks", "albums", "likes", "reposts"].contains(String(parts[1])),
              url.path.range(of: "^/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/?$", options: .regularExpression) != nil else { return nil }
        var canonical = URLComponents(); canonical.scheme = "https"; canonical.host = "soundcloud.com"; canonical.path = url.path
        return canonical.url
    }
    static func playlist(_ text: String) throws -> Playlist {
        guard text.utf8.count <= 1024 * 1024 else { throw fail("SoundCloud playlist is too large.") }
        let lines = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        guard lines.first == "#EXTM3U", lines.contains("#EXT-X-ENDLIST"),
              !lines.contains(where: { line in ["#EXT-X-KEY", "#EXT-X-SESSION-KEY", "#EXT-X-BYTERANGE", "#EXT-X-DISCONTINUITY", "#EXT-X-STREAM-INF", "#EXT-X-MEDIA:"].contains(where: { line.hasPrefix($0) }) }) else {
            throw fail("Only unencrypted, complete SoundCloud audio playlists can be imported.")
        }
        let maps = lines.filter { $0.hasPrefix("#EXT-X-MAP:") }
        guard maps.count == 1, !maps[0].contains("BYTERANGE"),
              let mapString = capture("URI=\"([^\"]+)\"", maps[0]).first,
              let initialization = URL(string: mapString), mediaURL(initialization) else {
            throw fail("This SoundCloud audio format is not supported yet.")
        }
        var segments: [URL] = []
        var duration = 0.0
        var pending: Double?
        for line in lines {
            if line.hasPrefix("#EXTINF:") {
                guard pending == nil, let value = line.dropFirst(8).split(separator: ",").first,
                      let seconds = Double(value), seconds > 0, seconds.isFinite else {
                    throw fail("Invalid SoundCloud audio duration.")
                }
                pending = seconds
            } else if !line.hasPrefix("#") {
                guard let seconds = pending, let url = URL(string: line), mediaURL(url), !url.path.contains("/preview/") else {
                    throw fail("Unsupported SoundCloud media segment.")
                }
                pending = nil; duration += seconds; segments.append(url)
                guard duration <= 7200, segments.count <= 720 else { throw fail("SoundCloud imports are limited to two hours.") }
            }
        }
        guard pending == nil, !segments.isEmpty, duration > 0 else { throw fail("SoundCloud playlist is empty or incomplete.") }
        return Playlist(initialization: initialization, segments: segments, duration: duration)
    }
    static func fail(_ message: String) -> NSError {
        NSError(domain: "WAVESoundCloud", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
