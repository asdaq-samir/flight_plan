package app.wingtipmaps;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;

/**
 * The radio heard through the microphone by Android's speech recognizer
 * (SpeechRecognizer), a transmission at a time, each handed to the page as
 * it is said (web/src/lib/listen, lib/atcRadio) -- the iOS app's
 * SpeechPlugin, Apple's recognizer there. Android's recognizer hears one
 * utterance and stops, so it is started again after each until the pilot
 * stops it; while the app is open only (listening in the background takes
 * a foreground service, not built). Told the names near the route to
 * listen for, where Android takes them (EXTRA_BIASING_STRINGS, Android 13
 * and later), and to let the pauses within a transmission go by.
 */
@CapacitorPlugin(name = "Speech", permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") })
public class SpeechPlugin extends Plugin {

    /** A clearance pauses between its items: four seconds of quiet before
     *  the recognizer takes it as done. */
    private static final int QUIET_MS = 4000;

    private SpeechRecognizer recognizer;
    private Intent intent;
    private boolean listening;
    /** The transmission being heard, numbered on from the first. */
    private int id;

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphoneAsked");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void microphoneAsked(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            begin(call);
        } else {
            call.reject("refused");
        }
    }

    private void begin(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("Speech recognition is not available on this phone.");
            return;
        }
        ArrayList<String> words = new ArrayList<>();
        JSArray given = call.getArray("words", new JSArray());
        try {
            List<String> list = given.toList();
            words.addAll(list);
        } catch (JSONException ignored) {
            // No names to listen for: it listens all the same.
        }
        getActivity().runOnUiThread(() -> {
            end();
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new Heard());
            intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, QUIET_MS);
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, QUIET_MS);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !words.isEmpty()) {
                intent.putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, words);
            }
            listening = true;
            recognizer.startListening(intent);
            call.resolve();
        });
    }

    /** The next transmission, heard afresh. */
    private void again() {
        id++;
        if (listening && recognizer != null) {
            recognizer.startListening(intent);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            listening = false;
            end();
            notifyListeners("ended", new JSObject());
            call.resolve();
        });
    }

    private void end() {
        listening = false;
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
    }

    private void heard(Bundle results, boolean last) {
        ArrayList<String> texts = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (texts == null || texts.isEmpty()) {
            return;
        }
        JSObject data = new JSObject();
        data.put("id", id);
        data.put("text", texts.get(0));
        data.put("final", last);
        notifyListeners("heard", data);
    }

    /** The recognizer's own error in the words the page knows (lib/listen). */
    private static String errorOf(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "no-speech";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "refused";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "network";
            case SpeechRecognizer.ERROR_AUDIO:
                return "audio-capture";
            default:
                return "Speech recognition failed (" + code + ").";
        }
    }

    private class Heard implements RecognitionListener {
        @Override public void onReadyForSpeech(Bundle params) {}
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onEvent(int eventType, Bundle params) {}

        @Override
        public void onPartialResults(Bundle partialResults) {
            heard(partialResults, false);
        }

        @Override
        public void onResults(Bundle results) {
            heard(results, true);
            again();
        }

        @Override
        public void onError(int error) {
            // Quiet is no failure while listening to a radio: heard again.
            if (listening && (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)) {
                again();
                return;
            }
            end();
            JSObject data = new JSObject();
            data.put("error", errorOf(error));
            notifyListeners("ended", data);
        }
    }
}
