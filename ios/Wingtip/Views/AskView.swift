import SwiftUI

/// Ask: a question about the flight put to the assistant
/// (AssistantClient), which answers in words with the planner's own
/// figures and the raw reports it read, each a chip under the answer
/// that opens the report as sent. The conversation is bubbles, the
/// assistant's on the left, the pilot's on the right in the tint; while
/// the assistant looks something up its own words for that stand under
/// the last bubble, and the answer's text appends as it streams. A
/// question is typed, or said once through the microphone
/// (ClearanceListener.hearOnce). Presented as a sheet, from the sparkle
/// button beside the microphone on the map (RootView's owner places it):
/// `.sheet(isPresented:) { AskView() }`, with Plan, OwnShip, Session and
/// Verdict in the environment as the root puts them.
struct AskView: View {
    @Environment(Plan.self) private var plan
    @Environment(OwnShip.self) private var ownShip
    @Environment(Session.self) private var session
    @Environment(Verdict.self) private var verdict
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var client = AssistantClient()
    @State private var question = ""
    /// The chip tapped, its raw text on a sheet.
    @State private var source: AssistantSource?
    /// Why the microphone could not be used, under the field.
    @State private var micProblem: String?
    @FocusState private var typing: Bool
    private var listener: ClearanceListener { ClearanceListener.shared }

    /// What a pilot asks first, offered while there is nothing to read.
    static let suggestions = [
        "Is the weather good enough for my minimums?",
        "What's the crosswind at my destination?",
        "Brief me",
    ]

    private var context: AssistantContext {
        AssistantContext.make(plan: plan, ownShip: ownShip, session: session, minimums: verdict.minimums)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                conversation
                Divider()
                composer
            }
            .navigationTitle("Ask")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .accessibilityLabel("Close")
                }
            }
            .sheet(item: $source) { source in SourceSheet(source: source) }
            .onDisappear { client.cancel() }
        }
    }

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if client.turns.isEmpty {
                        suggestionsList
                    }
                    ForEach(client.turns) { turn in
                        TurnBubble(turn: turn, onSource: { source = $0 })
                            .id(turn.id)
                    }
                    if let status = client.status {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text(status).font(.footnote).foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                        .id("status")
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: client.turns.last?.content) {
                guard let last = client.turns.last else { return }
                // The answer kept in sight as it grows; a jump, not a
                // glide, with Reduce Motion on.
                if reduceMotion {
                    proxy.scrollTo(last.id, anchor: .bottom)
                } else {
                    withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }

    private var suggestionsList: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Ask about the flight")
                .font(.title3.weight(.semibold))
            Text("The figures are the planner's; the assistant puts them in words and shows what it read.")
                .font(.footnote).foregroundStyle(.secondary)
            ForEach(Self.suggestions, id: \.self) { words in
                Button { send(words) } label: {
                    HStack {
                        Text(words).multilineTextAlignment(.leading)
                        Spacer()
                        Image(systemName: "arrow.up.circle").accessibilityHidden(true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 8)
                }
                .contentShape(Rectangle().inset(by: -6))
                .accessibilityHint("Asks the assistant")
            }
        }
        .padding(.bottom, 8)
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Ask about the flight", text: $question, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.send)
                    .focused($typing)
                    .onSubmit { send(question) }
                    .accessibilityLabel("Your question")
                Button {
                    Task { await hear() }
                } label: {
                    Image(systemName: "mic.fill")
                        .foregroundStyle(listener.hearingOnce ? Color.accentColor : .secondary)
                        .symbolEffect(.pulse, isActive: listener.hearingOnce && !reduceMotion)
                        .frame(width: 28, height: 28)
                }
                .contentShape(Rectangle().inset(by: -8))
                .disabled(client.answering)
                .accessibilityLabel(listener.hearingOnce ? "Listening" : "Ask by voice")
                Button { send(question) } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                        .frame(width: 28, height: 28)
                }
                .contentShape(Rectangle().inset(by: -8))
                .disabled(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel("Send")
            }
            ProblemLine(micProblem)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private func send(_ words: String) {
        let words = words.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { return }
        question = ""
        micProblem = nil
        client.ask(words, context: context)
    }

    /// One question said: the route's idents are given the recognizer as
    /// words to listen for, so "KMSN" is not "Kay Em Ess En".
    private func hear() async {
        micProblem = nil
        typing = false
        if let said = await listener.hearOnce(words: plan.idents.filter { !$0.isEmpty }) {
            send(said)
        } else {
            micProblem = listener.problem ?? "Nothing was heard."
        }
    }
}

/// One turn: the pilot's words in the tint on the right, the assistant's
/// on the left with its source chips and, where the stream broke, why.
private struct TurnBubble: View {
    let turn: AssistantTurn
    let onSource: (AssistantSource) -> Void

    var body: some View {
        VStack(alignment: turn.role == .user ? .trailing : .leading, spacing: 6) {
            if turn.role == .user {
                Text(turn.content)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .accessibilityLabel("You asked: \(turn.content)")
            } else {
                if !turn.content.isEmpty {
                    Text(turn.content)
                        .textSelection(.enabled)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityLabel("The assistant: \(turn.content)")
                }
                if !turn.sources.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(turn.sources) { source in
                                Button(source.label) { onSource(source) }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                                    .contentShape(Rectangle().inset(by: -8))
                                    .accessibilityLabel("Source: \(source.label)")
                                    .accessibilityHint("Shows the report as sent")
                            }
                        }
                    }
                }
                ProblemLine(turn.problem)
            }
        }
        .frame(maxWidth: .infinity, alignment: turn.role == .user ? .trailing : .leading)
    }
}

/// The raw report a chip stands for, as sent, in a fixed-width face so a
/// METAR's groups line up as pilots read them.
private struct SourceSheet: View {
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
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .accessibilityLabel("Close")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

#Preview("AskView") {
    AskView()
        .environment(Session())
        .environment(Plan())
        .environment(OwnShip())
        .environment(Verdict())
}
