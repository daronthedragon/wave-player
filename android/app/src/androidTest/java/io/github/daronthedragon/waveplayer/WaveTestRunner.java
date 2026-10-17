package io.github.daronthedragon.waveplayer;

import android.os.Bundle;
import androidx.test.runner.AndroidJUnitRunner;

/** Keeps provider-network checks opt-in; ordinary connected tests are fully offline. */
public final class WaveTestRunner extends AndroidJUnitRunner {
    static boolean liveAudio;
    @Override public void onCreate(Bundle arguments) {
        liveAudio = arguments != null && "true".equals(arguments.getString("waveLiveAudio"));
        super.onCreate(arguments);
    }
}
