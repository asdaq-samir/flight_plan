import SwiftUI

/// The dry run's controls over the map: how far along, pause and play,
/// its speed, and the way out.
struct DryRunControls: View {
    @Environment(DryRun.self) private var dryRun

    var body: some View {
        @Bindable var dryRun = dryRun
        HStack(spacing: 10) {
            Button { dryRun.running ? dryRun.pause() : dryRun.resume() } label: {
                Image(systemName: dryRun.running ? "pause.fill" : "play.fill").frame(width: 32, height: 32)
            }
            .accessibilityLabel(dryRun.running ? "Pause the dry run" : "Play the dry run")
            Text(hoursMinutes(dryRun.flownS / 60)).font(.subheadline.monospacedDigit())
            Picker("Speed", selection: $dryRun.speed) {
                Text("1×").tag(1.0); Text("10×").tag(10.0); Text("60×").tag(60.0)
            }
            .pickerStyle(.menu)
            Button { dryRun.stop() } label: { Image(systemName: "xmark").frame(width: 32, height: 32) }
                .accessibilityLabel("End the dry run")
        }
        .padding(.horizontal, 8)
        .background(.regularMaterial, in: Capsule())
    }
}
