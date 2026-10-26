import Foundation
import Testing
@testable import Wingtip

/// An instructor past their date is warned and still signs (14 CFR
/// 61.197(a) and (e), the owner's rule of 2026-10-26): the warning's
/// words match the web's lib/endorsements, and the signature line keeps
/// the passed date.
@MainActor
struct CfiWarnTests {
    private func jo(_ until: String?, _ kind: String) -> Instructor {
        Instructor(fullName: "J. J. Jones", certificate: "987654321CFI", until: until, untilKind: kind,
                   asking: [], students: [], kinds: [], reviews: [], signed: [])
    }

    @Test func nothingOnOrBeforeTheDate() {
        #expect(Endorsing.lapseWarning(jo("2026-10-25", "RE"), signedOn: "2026-10-25") == nil)
        #expect(Endorsing.lapseWarning(jo(nil, "RE"), signedOn: "2026-10-25") == nil)
    }

    @Test func recentExperienceRunOut() {
        #expect(Endorsing.lapseWarning(jo("2025-12-31", "RE"), signedOn: "2026-10-25")
                == "Your recent experience ran out on 31 Dec 2025: 14 CFR 61.197(a) asks for recent experience in the preceding 24 calendar months before you sign as an instructor.")
    }

    @Test func anOlderCertificateExpired() {
        let words = Endorsing.lapseWarning(jo("2025-11-30", "EXP"), signedOn: "2026-10-25")
        #expect(words?.hasPrefix("Your certificate expired on 30 Nov 2025: 14 CFR 61.197(e)") == true)
        #expect(Endorsing.signatureLine(jo("2025-11-30", "EXP"), signedOn: "2026-10-25") == "/s/ 10-25-2026 J. J. Jones 987654321CFI Exp. 11-30-2025")
    }
}
