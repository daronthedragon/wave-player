package io.github.daronthedragon.waveplayer;

import android.os.Bundle;
import android.test.InstrumentationTestRunner;

/** Keeps provider-network checks opt-in; ordinary connected tests are fully offline. */
@SuppressWarnings("deprecation")
public final class WaveTestRunner extends InstrumentationTestRunner {
    static boolean liveAudio;
    @Override public void onCreate(Bundle arguments) {
        liveAudio = arguments != null && "true".equals(arguments.getString("waveLiveAudio"));
        super.onCreate(arguments);
    }
}
