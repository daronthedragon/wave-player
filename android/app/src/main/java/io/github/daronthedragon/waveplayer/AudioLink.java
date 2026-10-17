package io.github.daronthedragon.waveplayer;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.Set;
import java.util.HashSet;
import java.util.Arrays;

/** Small, dependency-free boundary: native extraction accepts a public track, not an arbitrary URL. */
final class AudioLink {
    private static final Set<String> RESERVED = new HashSet<>(Arrays.asList("discover", "search", "you", "stream", "upload",
            "settings", "charts", "stations", "pages", "terms-of-use", "privacy", "jobs"));

    static String canonical(String value) {
        if (value == null || value.length() > 4096 || value.matches("(?s).*[\\\\\\s\\p{Cntrl}].*")) return null;
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getRawUserInfo() != null
                    || uri.getPort() != -1 || uri.getHost() == null) return null;
            String host = uri.getHost().toLowerCase(Locale.ROOT);
            String path = uri.getRawPath();
            if (host.equals("www.youtube.com") || host.equals("youtube.com") || host.equals("m.youtube.com")
                    || host.equals("music.youtube.com")) {
                if (!"/watch".equals(path)) return null;
                String id = null;
                if (uri.getRawQuery() == null) return null;
                for (String parameter : uri.getRawQuery().split("&")) {
                    if (parameter.startsWith("v=")) {
                        if (id != null) return null;
                        id = parameter.substring(2);
                    }
                }
                return id != null && id.matches("[A-Za-z0-9_-]{11}")
                        ? "https://www.youtube.com/watch?v=" + id : null;
            }
            if (host.equals("youtu.be") && path != null && path.matches("/[A-Za-z0-9_-]{11}")) {
                return "https://www.youtube.com/watch?v=" + path.substring(1);
            }
            if (host.equals("soundcloud.com") || host.equals("www.soundcloud.com") || host.equals("m.soundcloud.com")) {
                if (path == null || !path.matches("/[A-Za-z0-9_-]{1,200}/[A-Za-z0-9_-]{1,200}")) return null;
                String[] parts = path.substring(1).split("/");
                if (RESERVED.contains(parts[0].toLowerCase(Locale.ROOT)) || parts[1].equalsIgnoreCase("sets")) return null;
                return "https://soundcloud.com" + path;
            }
        } catch (URISyntaxException ignored) { }
        return null;
    }

    static boolean validRequestId(String id) {
        return id != null && id.matches("[A-Za-z0-9_-]{1,80}");
    }
}
