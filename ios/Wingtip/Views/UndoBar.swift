import SwiftUI

/// "Route cleared · Undo" for six seconds after an edit that took
/// something away -- the route cleared, a stop removed, the route
/// replaced by Fly Here or a Direct to, a procedure or a hold taken off --
/// in place of a question before it (the owner's "make the pilot aware,
/// never restrict them"). Shake and the Edit menu undo it too, and any
/// other step (PlanHistory).
struct UndoBar: View {
    @Environment(Plan.self) private var plan

    var body: some View {
        if let note = plan.undoNote {
            HStack(spacing: 12) {
                Text(note.words)
                    .font(.subheadline)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Button("Undo") { plan.undo() }
                    .fontWeight(.semibold)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .padding(.leading, 16)
            .padding(.trailing, 8)
            .background(.thickMaterial, in: Capsule())
            .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
            .padding(.horizontal, 16)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .accessibilityElement(children: .contain)
            .task(id: note.id) {
                AccessibilityNotification.Announcement(note.words).post()
                try? await Task.sleep(for: .seconds(6))
                plan.dismissUndoNote(note)
            }
        }
    }
}
