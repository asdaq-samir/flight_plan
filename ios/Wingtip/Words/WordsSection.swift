import SwiftUI

/// "In words": the briefing's or the Go / No-Go's sentences over its
/// figures, each with the chips of the figures it rests on; a chip opens
/// the raw text in a sheet. The caption says which model wrote them
/// ("From the planner", "On this iPhone"), and with no words a plain
/// line says why. The figures the screen shows under it are untouched:
/// the words are read with them, never instead of them.
struct WordsSection: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The header: "The weather in words", "The flight in words".
    var title: LocalizedStringKey = "In words"
    let said: SaidWords?
    /// Shown while the words are being written, where there is nothing yet.
    var writing = false
    @State private var opened: WordsSource?

    var body: some View {
        Section {
            if let said {
                if said.words.sentences.isEmpty {
                    Text(said.words.unavailable ?? "Nothing to say.")
                        .font(.subheadline).foregroundStyle(.secondary)
                } else {
                    ForEach(Array(said.words.sentences.enumerated()), id: \.offset) { _, sentence in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(sentence.text)
                            chips(sentence, words: said.words)
                        }
                        .accessibilityElement(children: .contain)
                    }
                }
            } else if writing {
                ProgressView("Writing the words…")
            }
        } header: {
            HStack {
                Text(title)
                Spacer()
                if let said, said.origin != .none {
                    Text(said.origin.caption).textCase(nil).font(.footnote)
                }
            }
        }
        .animation(reduceMotion ? nil : .default, value: said)
        .sheet(item: $opened) { source in
            NavigationStack {
                ScrollView {
                    Text(source.text)
                        .font(.body.monospaced())
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                }
                .navigationTitle(source.label)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { opened = nil } }
                }
            }
            .presentationDetents([.medium, .large])
        }
    }

    /// The chips of the figures a sentence cites, in a row that scrolls
    /// where it is long; each a small bordered button with a 44-point hit
    /// area beyond its shape, the row's 8-point gap so the areas meet.
    @ViewBuilder private func chips(_ sentence: WordsSentence, words: Words) -> some View {
        let cited = sentence.sources.compactMap(words.source)
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(cited) { source in
                    Button {
                        opened = source
                    } label: {
                        Text(source.label).font(.footnote).lineLimit(1)
                            .contentShape(Rectangle().inset(by: -8))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .accessibilityHint("Shows the report as sent")
                }
            }
            .padding(.vertical, 2)
        }
        .scrollClipDisabled()
    }
}

#Preview("WordsSection") {
    let words = Words(
        sentences: [
            WordsSentence(text: "KMSN is VFR now, with a few clouds at 4,500 ft and 10 sm.", sources: ["metar:KMSN"]),
            WordsSentence(text: "An IFR G-AIRMET lies along the route from 14:00 to 17:00.", sources: ["gairmet:0", "flight:route"]),
        ],
        sources: [
            WordsSource(id: "flight:route", label: "The flight", text: "KMSN to KDLH. 95 minutes in the air."),
            WordsSource(id: "metar:KMSN", label: "KMSN METAR, VFR", text: "KMSN 031853Z 27008KT 10SM FEW045 12/03 A3012"),
            WordsSource(id: "gairmet:0", label: "G-AIRMET, IFR", text: "G-AIRMET: IFR. Due to clouds. Valid at 1500Z."),
        ],
        model: "claude", unavailable: nil)
    List {
        WordsSection(said: SaidWords(words: words, origin: .planner))
        WordsSection(said: SaidWords(words: .none("none", "No words: the planner cannot be reached, and words on this iPhone need iOS 26."), origin: .none))
        WordsSection(said: nil, writing: true)
    }
}
