import SwiftUI

/// A field's procedures as pull-down menus, the owner's pick for the web
/// app (2026-10-19): a departure out of the route's departure, an arrival
/// and an approach into a stop or the destination, each a menu of the
/// FAA's procedures for the field, none picked until the pilot picks.
/// Picked, the planner flies it and plans the descent to it.
struct ProceduresRow: View {
    @Environment(Plan.self) private var plan
    let ident: String
    /// The kinds this field takes: "departure" for the route's departure,
    /// "arrival" and "approach" for the rest.
    let kinds: [String]
    @State private var list: ProcedureList?

    var body: some View {
        HStack(spacing: 8) {
            Text(ident).font(.body.monospaced())
            Spacer()
            if let list {
                ForEach(kinds, id: \.self) { kind in
                    let mine = list.procedures.filter { $0.kind == kind }
                    if !mine.isEmpty {
                        Menu {
                            Button("None") { plan.pick(nil, kind: kind, at: ident) }
                            ForEach(mine) { procedure in
                                if procedure.transitions.isEmpty {
                                    Button(procedure.name) { plan.pick(ProcedurePick(ident: ident, id: procedure.id, kind: kind, name: procedure.name), kind: kind, at: ident) }
                                } else {
                                    Menu(procedure.name) {
                                        Button("As published") { plan.pick(ProcedurePick(ident: ident, id: procedure.id, kind: kind, name: procedure.name), kind: kind, at: ident) }
                                        ForEach(procedure.transitions, id: \.self) { transition in
                                            Button("\(transition) transition") { plan.pick(ProcedurePick(ident: ident, id: procedure.id, kind: kind, name: procedure.name, transition: transition), kind: kind, at: ident) }
                                        }
                                    }
                                }
                            }
                        } label: {
                            let picked = plan.procedures.first { $0.ident == ident && $0.kind == kind }
                            Label(picked?.name ?? kind.capitalized, systemImage: "chevron.down")
                                .labelStyle(.titleAndIcon)
                                .font(.subheadline)
                                .foregroundStyle(picked == nil ? Color.secondary : Color.accentColor)
                        }
                    }
                }
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .task(id: ident) {
            list = try? await Planner.procedures(ident)
        }
    }
}
