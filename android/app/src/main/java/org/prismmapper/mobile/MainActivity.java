package org.prismmapper.mobile;

import android.graphics.Color;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

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
    }
}
