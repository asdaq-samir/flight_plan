package app.wingtipmaps;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/** The Android app's one screen: the site in Capacitor's web view
 *  (capacitor.config.ts), with the device's location, share sheet and
 *  links through its plugins, and the app's own: a cockpit receiver's
 *  GDL 90 (Gdl90Plugin) and a clearance heard (SpeechPlugin). */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(Gdl90Plugin.class);
        registerPlugin(SpeechPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
