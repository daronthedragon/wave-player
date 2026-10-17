package io.github.daronthedragon.waveplayer;

import android.content.Context;
import com.yausername.youtubedl_android.YoutubeDL;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Installs only the checked extractor shipped in this APK, including over older installs. */
final class PackagedExtractor {
    static final String VERSION = "2026.08.19";
    static final String SHA256 = "1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6";

    private PackagedExtractor() { }

    static synchronized void initialize(Context context) throws Exception {
        // These public wrapper constants identify its extractor, never user media.
        File directory = new File(new File(context.getNoBackupFilesDir(), YoutubeDL.baseName), YoutubeDL.ytdlpDirName);
        File target = new File(directory, YoutubeDL.ytdlpBin);
        try (InputStream payload = context.getResources().openRawResource(R.raw.ytdlp)) {
            install(target, payload, SHA256);
        }
        YoutubeDL.getInstance().init(context);
    }

    /** Returns true only when replacing a missing, old, or damaged extractor. */
    static boolean install(File target, InputStream payload, String expectedHash) throws IOException {
        if (target.isFile()) {
            try (InputStream current = new FileInputStream(target)) {
                if (expectedHash.equals(digest(current))) return false;
            }
        }
        File directory = target.getParentFile();
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot prepare packaged extractor");
        File temporary = File.createTempFile("wave-extractor-", ".tmp", directory);
        try {
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[32768];
                for (int count; (count = payload.read(buffer)) != -1;) output.write(buffer, 0, count);
                output.getFD().sync();
            }
            try (InputStream copied = new FileInputStream(temporary)) {
                if (!expectedHash.equals(digest(copied))) throw new IOException("Packaged extractor checksum mismatch");
            }
            // Same-directory rename is atomic. An interruption cannot leave half an extractor.
            Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            return true;
        } finally {
            Files.deleteIfExists(temporary.toPath());
        }
    }

    private static String digest(InputStream input) throws IOException {
        final MessageDigest digest;
        try { digest = MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException unavailable) { throw new IOException("SHA-256 unavailable", unavailable); }
        byte[] buffer = new byte[32768];
        for (int count; (count = input.read(buffer)) != -1;) digest.update(buffer, 0, count);
        StringBuilder hex = new StringBuilder(64);
        for (byte value : digest.digest()) {
            hex.append(Character.forDigit((value >>> 4) & 15, 16));
            hex.append(Character.forDigit(value & 15, 16));
        }
        return hex.toString();
    }
}
