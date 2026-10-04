package org.prismmapper.mobile;

import android.graphics.Color;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "PrismMapper";

    // Android runs the page in a web view process of its own. When that process
    // is stopped (the device is short of memory) or crashes, Android closes the
    // whole app unless the app deals with it. The project is kept in the
    // browser storage of the page, so starting the screen again brings it back.
    // A web view that keeps dying is not worth restarting forever, so after a
    // few restarts within a minute the app is left to close.
    private static final int MAX_RESTARTS = 3;
    private static final long RESTART_WINDOW_MS = 60_000L;
    private static int restarts = 0;
    private static long windowStartedAt = 0L;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Draw behind the system bars on every Android version. Capacitor's
        // SystemBars plugin (insetsHandling "css" in capacitor.config.ts) then
        // pads the web view and publishes the insets to CSS. Both bars are
        // transparent with light icons because the app is dark only.
        EdgeToEdge.enable(this, SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT));
        super.onCreate(savedInstanceState);

        // Prism Mapper is a projection tool: keep the screen on while the app
        // is in the foreground. The flag has no effect once the app is in the
        // background, so the normal screen timeout applies again.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        getBridge().addWebViewListener(
            new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    return restartAfterWebViewLoss(detail.didCrash());
                }
            }
        );
    }

    // Returns true when the loss is handled, which keeps the app alive. Android
    // asks for the old web view to be discarded, and recreating the activity
    // does that: Capacitor destroys the web view when the activity goes away.
    private boolean restartAfterWebViewLoss(boolean crashed) {
        if (isFinishing() || isDestroyed()) {
            return true;
        }
        long now = SystemClock.elapsedRealtime();
        if (restarts == 0 || now - windowStartedAt > RESTART_WINDOW_MS) {
            restarts = 0;
            windowStartedAt = now;
        }
        if (restarts >= MAX_RESTARTS) {
            Log.w(TAG, "The web view process stopped again, not restarting the screen any more.");
            return false;
        }
        restarts++;
        Log.w(
            TAG,
            "The web view process " + (crashed ? "crashed" : "was stopped by the system") + ", restarting the screen (" + restarts + " of " + MAX_RESTARTS + ")."
        );
        runOnUiThread(this::recreate);
        return true;
    }
}
