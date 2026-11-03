import SwiftUI

/// The picked airplane's checklist as the phone read it from the gateway
/// (WatchContext.checklist): its sections as a list, each a page of items
/// to tick. The ticks are this run's, kept on the watch alone; a
/// section is reset by swiping its row, and every tick goes when the
/// phone sends another checklist.
struct ChecklistView: View {
    @Environment(WatchSession.self) private var session
    /// Ticked items by section index and item index.
    @State private var ticked: Set<String> = []

    private var checklist: WatchChecklist? { session.context?.checklist }

    var body: some View {
        NavigationStack {
            Group {
                if let checklist, !checklist.sections.isEmpty {
                    List {
                        ForEach(Array(checklist.sections.enumerated()), id: \.offset) { s, section in
                            NavigationLink {
                                ChecklistSectionView(index: s, section: section, ticked: $ticked)
                            } label: {
                                HStack {
                                    Text(section.title)
                                    Spacer()
                                    Text("\(doneCount(s, section))/\(section.items.count)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .monospacedDigit()
                                }
                            }
                            .swipeActions(edge: .trailing) {
                                Button("Reset", role: .destructive) { reset(s, section) }
                            }
                        }
                    }
                } else if session.context?.tail == nil {
                    ContentUnavailableView("No airplane picked", systemImage: "airplane", description: Text("Pick an airplane on the iPhone."))
                } else {
                    ContentUnavailableView("No checklist yet", systemImage: "checklist", description: Text("Write it on the iPhone, from the flight manual."))
                }
            }
            .navigationTitle(session.context?.tail ?? "Checklist")
        }
        .onChange(of: checklist) { ticked = [] }
    }

    private func doneCount(_ s: Int, _ section: WatchChecklistSection) -> Int {
        section.items.indices.filter { ticked.contains(ChecklistSectionView.key(s, $0)) }.count
    }

    private func reset(_ s: Int, _ section: WatchChecklistSection) {
        for i in section.items.indices { ticked.remove(ChecklistSectionView.key(s, i)) }
    }
}

/// One section's items, the challenge and its response, each ticked by
/// a tap, as a printed checklist is read down.
struct ChecklistSectionView: View {
    let index: Int
    let section: WatchChecklistSection
    @Binding var ticked: Set<String>

    static func key(_ s: Int, _ i: Int) -> String { "\(s).\(i)" }

    var body: some View {
        List {
            ForEach(Array(section.items.enumerated()), id: \.offset) { i, item in
                let key = Self.key(index, i)
                let done = ticked.contains(key)
                Button {
                    if done { ticked.remove(key) } else { ticked.insert(key) }
                } label: {
                    HStack(alignment: .firstTextBaseline) {
                        Image(systemName: done ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(done ? Color.green : Color.secondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.challenge)
                                .strikethrough(done)
                                .foregroundStyle(done ? .secondary : .primary)
                            if let response = item.response, !response.isEmpty {
                                Text(response)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .accessibilityValue(done ? "Done" : "Not done")
            }
        }
        .navigationTitle(section.title)
    }
}
