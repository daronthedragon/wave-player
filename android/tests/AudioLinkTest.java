package io.github.daronthedragon.waveplayer;

/** Request-boundary regressions; run without Android or third-party dependencies. */
public final class AudioLinkTest {
    public static void main(String[] args) {
        expect("https://www.youtube.com/watch?v=M7lc1UVf-VE&list=PLtest&t=12", "https://www.youtube.com/watch?v=M7lc1UVf-VE");
        expect("https://youtu.be/M7lc1UVf-VE", "https://www.youtube.com/watch?v=M7lc1UVf-VE");
        expect("https://m.youtube.com/watch?v=M7lc1UVf-VE", "https://www.youtube.com/watch?v=M7lc1UVf-VE");
        expect("https://soundcloud.com/forss/flickermood?tracking=ignore", "https://soundcloud.com/forss/flickermood");
        for (String invalid : new String[] {null, "", "file:///etc/passwd", "http://youtube.com/watch?v=M7lc1UVf-VE",
                "https://youtube.com.evil.example/watch?v=M7lc1UVf-VE", "https://youtube.com@127.0.0.1/watch?v=M7lc1UVf-VE",
                "https://youtube.com:443/watch?v=M7lc1UVf-VE", "https://127.0.0.1/", "https://youtube.com/playlist?list=PLtest",
                "https://youtube.com/watch?v=short", "https://youtube.com/watch?v=M7lc1UVf-VE&v=M7lc1UVf-VE",
                "https://soundcloud.com/forss/sets/album", "https://soundcloud.com/search/tracks", "https://soundcloud.com/forss/sets",
                "https://soundcloud.com/forss/%2e%2e", "https://soundcloud.com/forss/../track", "https://soundcloud.com/forss/track/extra",
                "https://on.soundcloud.com/short", "https://soundcloud.com/forss/trac k", "https://soundcloud.com/forss/track\n",
                "https://soundcloud.com\\@evil.example/forss/track", "https://www.youtube.com/watch?v=%4d7lc1UVf-VE"}) expect(invalid, null);
        if (!AudioLink.validRequestId("ed4a1831-1af6-4226-9866-525f29e08258") || AudioLink.validRequestId(";touch x")
                || AudioLink.validRequestId("") || AudioLink.validRequestId("a".repeat(81))) throw new AssertionError("Request ID boundary");
        System.out.println("Native audio request boundaries passed (30 cases).");
    }
    private static void expect(String input, String expected) {
        String result = AudioLink.canonical(input);
        if (expected == null ? result != null : !expected.equals(result)) throw new AssertionError(input + " produced " + result);
    }
}
