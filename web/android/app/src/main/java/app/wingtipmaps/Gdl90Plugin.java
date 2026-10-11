package app.wingtipmaps;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;

/**
 * A cockpit ADS-B receiver's GDL 90 over Wi-Fi -- Stratux, SkyEcho,
 * Sentry -- heard as UDP datagrams on its port (4000) and handed to the
 * page as they come, base64, which reads them (web/src/lib/map/receiver,
 * lib/gdl90). A web page cannot receive UDP; the app can. Broadcast ones
 * too (SkyEcho sends to the network's broadcast address): Android's Wi-Fi
 * drops those unless a multicast lock is held while listening.
 */
@CapacitorPlugin(name = "Gdl90")
public class Gdl90Plugin extends Plugin {

    private DatagramSocket socket;
    private WifiManager.MulticastLock lock;

    @PluginMethod
    public void start(PluginCall call) {
        if (socket != null) {
            call.resolve();
            return;
        }
        int port = call.getInt("port", 4000);
        try {
            DatagramSocket listening = new DatagramSocket(null);
            listening.setReuseAddress(true);
            listening.setBroadcast(true);
            listening.bind(new InetSocketAddress(port));
            socket = listening;
            WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                lock = wifi.createMulticastLock("wingtip-gdl90");
                lock.setReferenceCounted(false);
                lock.acquire();
            }
            Thread reader = new Thread(() -> {
                byte[] buffer = new byte[4096];
                while (!listening.isClosed()) {
                    DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                    try {
                        listening.receive(packet);
                    } catch (IOException closed) {
                        break;
                    }
                    JSObject data = new JSObject();
                    data.put("data", Base64.encodeToString(packet.getData(), packet.getOffset(), packet.getLength(), Base64.NO_WRAP));
                    notifyListeners("packet", data);
                }
            }, "wingtip-gdl90");
            reader.setDaemon(true);
            reader.start();
            call.resolve();
        } catch (IOException e) {
            close();
            call.reject("Could not listen on port " + port + ": " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        close();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        close();
    }

    private void close() {
        if (socket != null) {
            socket.close();
            socket = null;
        }
        if (lock != null && lock.isHeld()) {
            lock.release();
        }
        lock = null;
    }
}
