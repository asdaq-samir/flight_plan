package app.wingtipmaps;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/** The Android app's one screen: the site in Capacitor's web view
 *  (capacitor.config.ts), with the device's location, share sheet and
 *  links through its plugins, and the app's own: a cockpit receiver's
 *  GDL 90 (Gdl90Plugin). */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(Gdl90Plugin.class);
        super.onCreate(savedInstanceState);
    }
}
