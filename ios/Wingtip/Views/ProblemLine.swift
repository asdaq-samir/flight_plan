import SwiftUI

/// A problem said where it happened, as the web app's lib/problems says
/// it: the call's own words in red at the footnote's size under what
/// failed, and nothing at all without one.
struct ProblemLine: View {
    let problem: String?

    init(_ problem: String?) { self.problem = problem }

    var body: some View {
        if let problem { Text(problem).foregroundStyle(.red).font(.footnote) }
    }
}
