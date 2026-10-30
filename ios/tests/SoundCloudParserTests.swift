import Foundation

@main
struct SoundCloudParserTests {
    static func main() throws {
        let host = "https://playback.media-streaming.soundcloud.cloud/test/"
        let manifest = """
        #EXTM3U
        #EXT-X-VERSION:7
        #EXT-X-MAP:URI="\(host)init.mp4"
        #EXTINF:10.007800,
        \(host)data000.m4s
        #EXTINF:3.885170,
        \(host)data001.m4s
        #EXT-X-ENDLIST
        """
        let parsed = try WaveSoundCloudParser.playlist(manifest)
        precondition(parsed.segments.count == 2 && abs(parsed.duration - 13.89297) < 0.0001)
        precondition(WaveSoundCloudParser.publicTrackURL("https://soundcloud.com/forss/flickermood?utm_source=share")?.absoluteString == "https://soundcloud.com/forss/flickermood")
        for raw in ["https://soundcloud.com.evil.test/a/b", "https://soundcloud.com@evil.test/a/b", "http://soundcloud.com/a/b", "https://soundcloud.com/a/b/private", "https://soundcloud.com/a/sets", "https://soundcloud.com:443/a/b"] {
            precondition(WaveSoundCloudParser.publicTrackURL(raw) == nil)
        }
        for invalid in [
            manifest.replacingOccurrences(of: "#EXT-X-ENDLIST", with: ""),
            manifest + "\n#EXT-X-KEY:METHOD=AES-128,URI=\"\(host)key\"",
            manifest + "\n#EXT-X-DISCONTINUITY",
            manifest + "\n#EXT-X-BYTERANGE:32@0",
            manifest.replacingOccurrences(of: "#EXTINF:10.007800,", with: "#EXTINF:"),
            manifest.replacingOccurrences(of: "#EXTINF:10.007800,", with: "#EXTINF:9000,"),
            manifest.replacingOccurrences(of: "data000.m4s", with: "preview/data000.m4s"),
            manifest.replacingOccurrences(of: "https://playback.media-streaming.soundcloud.cloud/test/data000.m4s", with: "https://example.com/audio.m4s")
        ] {
            do { _ = try WaveSoundCloudParser.playlist(invalid); fatalError("Accepted invalid playlist") } catch { }
        }
        print("SoundCloud parser: valid fMP4 playlist and malformed/encrypted/preview/host/duration rejection checks passed")
    }
}
