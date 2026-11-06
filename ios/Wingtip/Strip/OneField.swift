import SwiftUI

/// The one field, the sheet's pill row (the owner's change of 2026-11-04
/// after Apple Maps' screenshot): the grabber, then one row -- a glass
/// search field with the magnifier at its left, "Where to, or ask" in
/// it and the microphone's glyph inside at its right end, and the round
/// profile avatar beside it. What the field takes is read by
/// FieldCommands.read -- idents are a route, a name a place, a screen's
/// word that screen, anything else a question for the assistant -- and
/// done by the sheet (StripSheetView), which answers why not where it
/// cannot, said under the field. In the air the field is the radio's:
/// the words heard in it as they come, nothing typed.
struct StripFieldRow: View {
    @Binding var text: String
    /// In the air: read-only, the radio's words in it.
    var flying = false
    var listening = false
    var busy = false
    let onSubmit: () -> Void
    let onMic: () -> Void
    @FocusState.Binding var focused: Bool
    @Environment(\.chartInk) private var ink
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var placeholder: String {
        if flying { return listening ? "Listening…" : "Tap the mic and say it" }
        return "Where to, or ask"
    }

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(ink.muted)
                    .accessibilityHidden(true)
                TextField(placeholder, text: $text)
                    .font(ChartInk.text)
                    .focused($focused)
                    .submitLabel(.go)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .disabled(flying || busy)
                    .onSubmit(onSubmit)
                    .accessibilityLabel(flying ? "The radio" : "Where to, or ask anything")
                if !text.isEmpty && !flying {
                    Button {
                        text = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(ink.muted)
                            .contentShape(Rectangle().inset(by: -8))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear")
                }
                Button(action: onMic) {
                    Image(systemName: listening ? "mic.fill" : "mic")
                        .font(.body.weight(.medium))
                        .foregroundStyle(listening ? ink.tint : ink.muted)
                        .symbolEffect(.pulse, isActive: listening && !reduceMotion)
                        // The 44-point hit area round the glyph, which does not grow.
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle().inset(by: -8))
                }
                .buttonStyle(.plain)
                .disabled(listening || busy)
                .accessibilityLabel(listening ? "Listening" : "Say it")
            }
            .padding(.horizontal, 12)
            .frame(height: 44)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(ink.ink.opacity(0.08), lineWidth: 1))
            StripProfileMenu()
        }
        .accessibilityIdentifier("strip-field")
    }
}

/// The round profile avatar at the field's right (the strip layout has
/// no tabs): the pilot's initials, or a person's glyph signed out, and
/// a small menu -- My airplane, Logbook, Instructor, Settings, Sign in
/// or Sign out -- each opening the existing screen in the sheet
/// (StripSheetView.open). 44 points: its own size is the hit area.
struct StripProfileMenu: View {
    @Environment(Session.self) private var session
    @Environment(\.openStripScreen) private var open
    @Environment(\.chartInk) private var ink

    private var initials: String {
        StripData.initials(name: session.pilot?.displayName ?? session.pilot?.fullName, email: session.pilot?.email)
    }

    var body: some View {
        Menu {
            if let name = session.pilot?.displayName, !name.isEmpty {
                Text(name)
                Divider()
            }
            Button { open?(.airplane) } label: { Label("My airplane", systemImage: "airplane") }
            Button { open?(.logbook) } label: { Label("Logbook", systemImage: "book") }
            Button { open?(.instructor) } label: { Label("Instructor", systemImage: "graduationcap") }
            Button { open?(.settings) } label: { Label("Settings", systemImage: "gearshape") }
            Divider()
            if session.signedIn {
                Button { Task { await session.signOut() } } label: { Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right") }
            } else {
                // The sign-in is Setup's own card (SetupView, its Account group).
                Button { open?(.settings) } label: { Label("Sign in", systemImage: "person.crop.circle.badge.plus") }
            }
        } label: {
            ZStack {
                Circle().fill(.ultraThinMaterial)
                Circle().strokeBorder(ink.ink.opacity(0.08), lineWidth: 1)
                if initials.isEmpty {
                    Image(systemName: "person.fill").font(.body.weight(.medium)).foregroundStyle(ink.tint)
                } else {
                    Text(initials).font(ChartInk.detail.weight(.semibold)).foregroundStyle(ink.ink)
                }
            }
            .frame(width: 44, height: 44)
        }
        .menuOrder(.fixed)
        .accessibilityLabel(session.pilot?.displayName.map { "\($0): the pilot's menu" } ?? "The pilot's menu")
    }
}

/// What a pilot asks first, and the planner's other screens, as chips
/// while the field is focused and empty: how the rest is found without
/// tabs. Each one tap, handled as typed.
struct StripSuggestions: View {
    let suggestions: [String]
    let onPick: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(suggestions, id: \.self) { words in
                    Button(words) { onPick(words) }.buttonStyle(.inkChip)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 6)
        }
        .accessibilityIdentifier("strip-suggestions")
    }
}

/// The assistant's last answer, a card over the strip: the question, the
/// answer as it streams with the reports it rests on as chips, each
/// opening the report as sent; Stop while it answers, and ✕ forgetting
/// the conversation. The assistant is the app's own (AssistantClient);
/// the Brief's Ask (AskView) draws the whole conversation, this the last
/// turn.
struct StripAnswerCard: View {
    let client: AssistantClient
    let onClose: () -> Void
    @Environment(\.chartInk) private var ink
    @State private var source: AssistantSource?

    private var asked: AssistantTurn? { client.turns.last { $0.role == .user } }
    private var answer: AssistantTurn? { client.turns.last { $0.role == .assistant } }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Ask").font(ChartInk.heading).frame(maxWidth: .infinity, alignment: .leading)
                if client.answering {
                    Button { client.cancel() } label: { Label("Stop", systemImage: "stop.fill") }
                        .font(ChartInk.detail).buttonStyle(.plain).foregroundStyle(ink.tint)
                        .contentShape(Rectangle().inset(by: -8))
                }
                Button(action: onClose) {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(ink.muted)
                        .contentShape(Rectangle().inset(by: -10))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss the answer")
            }
            if let asked {
                Text(asked.content).font(ChartInk.detail).foregroundStyle(ink.muted)
                    .accessibilityLabel("You asked: \(asked.content)")
            }
            if let answer, !answer.content.isEmpty {
                Text(answer.content).font(ChartInk.text).textSelection(.enabled)
                    .accessibilityLabel("The assistant: \(answer.content)")
            }
            if let status = client.status {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text(status).font(ChartInk.note).foregroundStyle(ink.muted)
                }
                .accessibilityElement(children: .combine)
            }
            if let answer, !answer.sources.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(answer.sources) { s in
                            Button(s.label) { source = s }.buttonStyle(.inkChip)
                                .accessibilityLabel("Source: \(s.label)")
                                .accessibilityHint("Shows the report as sent")
                        }
                    }
                    .padding(.vertical, 6)
                }
            }
            ProblemLine(answer?.problem)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .inkCard()
        .sheet(item: $source) { source in StripSourceSheet(source: source) }
        .accessibilityIdentifier("strip-answer")
    }
}

/// The raw report a chip stands for, as sent, in a fixed-width face so a
/// METAR's groups line up as pilots read them.
struct StripSourceSheet: View {
    let source: AssistantSource
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(source.text)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
            }
            .navigationTitle(source.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                        .accessibilityLabel("Close")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// How the profile menu opens a screen: the sheet's own (StripSheetView
/// puts it in the environment), so the menu needs no binding to the path.
private struct OpenStripScreenKey: EnvironmentKey {
    static let defaultValue: ((FieldScreen) -> Void)? = nil
}

extension EnvironmentValues {
    var openStripScreen: ((FieldScreen) -> Void)? {
        get { self[OpenStripScreenKey.self] }
        set { self[OpenStripScreenKey.self] = newValue }
    }
}
