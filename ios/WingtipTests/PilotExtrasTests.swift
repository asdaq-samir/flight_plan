import Foundation
import Testing
@testable import Wingtip

/// The gateway's pilot records as springboot-app/openapi.json spells
/// them, read into the app's models, and the words and files the pilot's
/// pages make of them.
@MainActor
struct PilotRecordsTests {
    @Test func anAirplaneWithItsInspectionsSquawksAndVorCheck() throws {
        let json = #"{"id":7,"tailNumber":"N3429J","typeDesignator":"P28A","cruiseTasKt":110.0,"fuelBurnGph":8.5,"usableFuelGal":48.0,"cruisePowerPct":null,"climbTasKt":null,"climbFuelBurnGph":null,"equipment":"SDFGRY","surveillance":"B1","colour":"White, blue stripe","createdAt":"2026-10-01T12:00:00Z","inspections":{"annualOn":"2026-03-01","annualGoodThrough":"2027-03-31","eltBatteryDueOn":null,"eltInspectedOn":null,"eltInspectionGoodThrough":null,"hoursNow":2410.5,"hundredHourAtHours":2350.0,"hundredHourDueAtHours":2450.0,"staticCheckGoodThrough":null,"staticCheckOn":null,"transponderCheckGoodThrough":"2027-05-31","transponderCheckOn":"2025-05-10"},"openSquawks":[{"id":3,"reportedOn":"2026-10-20","text":"Landing light out","inoperative":true,"deferredFor":"VFR_DAY","fixedOn":null,"fixNote":null}],"vorCheck":{"checkedOn":"2026-10-10","errorDeg":2.0,"goodThrough":"2026-11-09","kind":"VOT","limitDeg":4.0,"place":"KDLH VOT","withinLimit":true}}"#
        let a = try JSONDecoder().decode(OwnAircraftRecord.self, from: Data(json.utf8))
        #expect(a.inspections?.hundredHourDueAtHours == 2450 && a.inspections?.annualGoodThrough == "2027-03-31")
        #expect(a.openSquawks?.first?.deferredFor == "VFR_DAY" && a.vorCheck?.withinLimit == true && a.vorCheck?.place == "KDLH VOT")
        #expect(a.tailNumber == "N3429J" && a.usableFuelGal == 48 && a.cruisePowerPct == nil)
        // An airplane with nothing recorded: the gateway's nulls.
        let bare = #"{"id":8,"tailNumber":"N1","typeDesignator":"C172","cruiseTasKt":110,"fuelBurnGph":8,"usableFuelGal":null,"cruisePowerPct":null,"climbTasKt":null,"climbFuelBurnGph":null,"equipment":null,"surveillance":null,"colour":null,"createdAt":"2026-10-01T12:00:00Z","inspections":null,"openSquawks":[],"vorCheck":null}"#
        let b = try JSONDecoder().decode(OwnAircraftRecord.self, from: Data(bare.utf8))
        #expect(b.inspections == nil && b.vorCheck == nil && b.openSquawks == [])
    }

    @Test func aChecklistSquawksAndTheSmallAnswers() throws {
        let checklist = try JSONDecoder().decode(Checklist.self, from: Data(#"{"sections":[{"title":"Before takeoff","items":[{"challenge":"Fuel selector","response":"Both"},{"challenge":"Doors","response":null}]}]}"#.utf8))
        #expect(checklist.sections[0].items[1].response == nil)
        let squawks = try JSONDecoder().decode([Squawk].self, from: Data(#"[{"id":1,"reportedOn":"2026-10-01","text":"Nav light","inoperative":false,"deferredFor":null,"fixedOn":"2026-10-05","fixNote":"Bulb"}]"#.utf8))
        #expect(squawks[0].fixNote == "Bulb" && squawks[0].request.fixedOn == "2026-10-05")
        #expect(try JSONDecoder().decode(Reminders.self, from: Data(#"{"on":true}"#.utf8)).on)
        #expect(try JSONDecoder().decode(LogbookImportResult.self, from: Data(#"{"added":3,"duplicates":1}"#.utf8)).duplicates == 1)
        let pilot = try JSONDecoder().decode(Pilot.self, from: Data(#"{"id":1,"email":"a@b.c","displayName":"A","fullName":null,"homeBase":"KDLH","phone":"2185550100","developer":false}"#.utf8))
        #expect(pilot.phone == "2185550100" && pilot.homeBase == "KDLH")
    }

    @Test func aLogbookEntryAndCurrencyWithEveryColumn() throws {
        let entry = #"{"id":4,"flownOn":"2026-10-12","aircraft":"N3429J","aircraftType":"P28A","route":"KDLH KHIB","remarks":"","totalHours":1.4,"nightHours":0,"crossCountryHours":1.4,"dualHours":1.4,"soloHours":0,"instrumentHours":0.3,"dayLandings":2,"nightLandings":0,"toweredLandings":1,"distanceNm":62,"longestLegNm":62,"approaches":1,"holding":true,"tracking":false}"#
        let e = try JSONDecoder().decode(LogbookEntry.self, from: Data(entry.utf8))
        #expect(e.dualHours == 1.4 && e.toweredLandings == 1 && e.holding == true)
        let request = LogbookEntryRequest(e)
        #expect(request.longestLegNm == 62 && request.approaches == 1)
        // Blank words go as nothing, not as "".
        let sent = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request.trimmed)) as? [String: Any]
        #expect(sent?["remarks"] == nil && sent?["route"] as? String == "KDLH KHIB")
        let currency = #"{"approachesInWindow":4,"crossCountryHours":20.1,"dayPassengersUntil":"2026-12-01","flightReviewOn":"2025-06-01","flightReviewUntil":"2027-06-30","flights":30,"holdingInWindow":true,"instrumentCurrentUntil":null,"ipcNeededAfter":"2026-04-30","ipcOn":null,"landings":60,"medicalExpiresOn":"2027-01-31","nightHours":3.2,"nightPassengersUntil":null,"totalHours":61.5,"trackingInWindow":false}"#
        let c = try JSONDecoder().decode(Currency.self, from: Data(currency.utf8))
        #expect(c.ipcNeededAfter == "2026-04-30" && c.ipcOn == nil && c.approachesInWindow == 4)
    }

    @Test func theStudentsRecordInFull() throws {
        let json = #"{"fullName":"Avery B. Student","instructors":[{"id":2,"email":"cfi@example.com","name":"J. J. Jones","accepted":true,"askedAt":"2026-10-01T10:00:00Z","certificate":"987654321CFI"}],"signed":[{"id":9,"code":"solo-xc","text":"I certify that Avery B. Student …","signedOn":"2026-10-10","until":"2027-01-08","voided":false,"signature":"/s/ 10-10-2026 J. J. Jones 987654321CFI RE 12-31-2027","studentName":"Avery B. Student","fields":{"mm":"Cessna 172"},"digest":"abc"}],"reviews":[{"id":5,"flightOn":"2026-10-30","makeModel":"Cessna 172","checks":[{"label":"Solo endorsement","detail":"Signed 10 Oct","rule":"61.93(d)(4)","met":true}],"answeredAt":null,"declinedNote":null,"instructorName":"J. J. Jones","askedAt":"2026-10-25T09:00:00Z","note":"First one","studentId":11,"studentName":"Avery B. Student","endorsement":null,"flight":{"id":40,"departureIdent":"KUGN","destinationIdent":"KUGN","stops":["KRFD"],"aircraftTailNumber":"N12345","cruiseAltitudeFt":3500,"totalDistanceNm":96.0,"totalEteMin":58.0,"totalFuelGal":7.9,"plannedFor":null,"createdAt":"2026-10-25T08:00:00Z","altitudes":null,"picks":null,"risk":null}}],"experience":[{"key":"total","label":"Total","rule":"61.109(a)","unit":"h","have":32.5,"need":40,"met":false}],"kinds":[{"code":"solo-xc-flight","label":"Solo cross-country","paragraph":"A.10","rule":"61.93(c)(3)","template":"I have reviewed the cross-country planning of {student}. I find the planning and preparation to be correct to make the solo flight from {from} to {to} via {via} with landings at {landings} in a {mm} on {date}.","validDays":null,"fields":[{"key":"from","label":"From","example":"KUGN","required":true}]}],"endorsements":[{"code":"pre-solo-knowledge","endorsedOn":"2026-09-01","until":null}],"knowledgeTestCodes":["PA.I.A.K1"]}"#
        let t = try JSONDecoder().decode(Training.self, from: Data(json.utf8))
        #expect(t.instructors[0].certificate == "987654321CFI" && t.signed[0].signature?.hasPrefix("/s/") == true)
        #expect(t.reviews[0].flight?.stops == ["KRFD"] && t.reviews[0].endorsement == nil && t.reviews[0].note == "First one")
        #expect(t.kinds?.first?.fields.first?.required == true && t.endorsements?.first?.endorsedOn == "2026-09-01" && t.knowledgeTestCodes == ["PA.I.A.K1"])
        #expect(Endorsing.route(t.reviews[0]) == "KUGN KRFD KUGN" && Endorsing.state(t.reviews[0]) == "Waiting for your instructor")
        let fields = Endorsing.reviewFields(t.reviews[0])
        #expect(fields["via"] == "KRFD" && fields["landings"] == "KRFD, KUGN" && fields["date"] == "10-30-2026")
        let words = Endorsing.render(t.kinds![0].template, student: "Avery B. Student", fields: fields.merging(["from": "KUGN"]) { $1 })
        #expect(words.contains("of Avery B. Student.") && words.contains("from KUGN to KUGN via KRFD with landings at KRFD, KUGN in a Cessna 172 on 10-30-2026."))
    }

    @Test func theInstructorsRecord() throws {
        let json = #"{"asking":[{"accepted":false,"askedAt":"2026-10-20T10:00:00Z","email":"s@example.com","experienceMet":0,"experienceOf":9,"linkId":3,"name":"Sam","reviewsWaiting":0,"soloUntil":null,"studentId":12}],"certificate":"987654321CFI","fullName":"J. J. Jones","kinds":[],"reviews":[],"signed":[],"students":[{"accepted":true,"askedAt":"2026-09-20T10:00:00Z","email":"a@example.com","experienceMet":4,"experienceOf":9,"linkId":2,"name":"Avery","reviewsWaiting":1,"soloUntil":"2026-12-01","studentId":11}],"until":"2027-12-31","untilKind":"RE"}"#
        let i = try JSONDecoder().decode(Instructor.self, from: Data(json.utf8))
        #expect(i.asking[0].linkId == 3 && i.students[0].reviewsWaiting == 1)
        #expect(InstructorView.studentLine(i.students[0]) == "4 of 9 of 61.109 · solo to 1 Dec 2026 · 1 waiting on you")
        #expect(Endorsing.signatureLine(i, signedOn: "2026-10-13") == "/s/ 10-13-2026 J. J. Jones 987654321CFI RE 12-31-2027")
        var expired = i
        expired.untilKind = "EXP"
        #expect(Endorsing.signatureLine(expired, signedOn: "2026-10-13").hasSuffix("987654321CFI Exp. 12-31-2027"))
    }

    @Test func theGatewaysOwnWordsForARefusal() {
        #expect(GatewayRefusal.words(in: Data(#"{"error":"Invalid request","details":["cruiseTasKt: must be greater than 0"]}"#.utf8)) == "Invalid request: cruiseTasKt: must be greater than 0")
        #expect(GatewayRefusal.words(in: Data(#"{"error":"That tail number is already registered","details":[]}"#.utf8)) == "That tail number is already registered")
        #expect(GatewayRefusal.words(in: Data("<html>".utf8)) == nil)
        #expect(GatewayRefusal(status: 502, words: nil).errorDescription == "The server answered 502.")
    }
}

@MainActor
struct PilotWordsTests {
    @Test func aChecklistWrittenAndReadBack() {
        let text = "Master -- On\n# Before takeoff\nFuel selector -- Both\nMixture ..... Rich\nFlaps\tUp\nDoors\n#\n# Empty\n"
        let c = ChecklistText.parse(text)
        #expect(c.sections.map(\.title) == ["Checklist", "Before takeoff"])
        #expect(c.sections[1].items.map(\.challenge) == ["Fuel selector", "Mixture", "Flaps", "Doors"])
        #expect(c.sections[1].items.map(\.response) == ["Both", "Rich", "Up", nil])
        #expect(ChecklistText.parse(ChecklistText.text(of: c)) == c)
    }

    @Test func foreFlightsExportReadIntoEntries() {
        let csv = "ForeFlight Logbook Import,,,,\r\nAircraft Table,,,,\r\nText,Text,Text,Text\r\nAircraftID,TypeCode,Year,Make,Model\r\nN3429J,P28A,1969,Piper,PA-28-140\r\n,,,,\r\nFlights Table,,,,\r\nDate,AircraftID,From,To,Route,TotalTime,Night,CrossCountry,AllLandings,NightLandingsFullStop,Approach1,Approach2,ActualInstrument,SimulatedInstrument,Holds,PilotComments\r\n2026-10-12,N3429J,KDLH,KHIB,,1.4,0.5,1.4,3,1,2;ILS;27;KDLH;,1;RNAV;9;KHIB;,0.2,0.3,1,\"Wind, gusty\"\r\n10/3/2026,N3429J,KDLH,KDLH,,30.5,,,,,,,,,,\r\nlater,N3429J,,,,1,,,,,,,,,,\r\n"
        let read = LogbookCSV.read(csv)
        #expect(read.entries.count == 1)
        let e = read.entries[0]
        #expect(e.flownOn == "2026-10-12" && e.aircraftType == "P28A" && e.route == "KDLH KHIB")
        #expect(e.dayLandings == 2 && e.nightLandings == 1 && e.approaches == 3 && e.instrumentHours == 0.5 && e.holding && e.remarks == "Wind, gusty")
        #expect(read.skipped.map(\.line) == [10, 11])
        #expect(read.skipped[0].reason.contains("more than a day"))
        #expect(LogbookCSV.dateOf("1/2/2002") == "2002-01-02" && LogbookCSV.dateOf("2002-1-2") == nil)
        #expect(LogbookCSV.summary(read, LogbookImportResult(added: 1, duplicates: 0)).hasPrefix("1 flight added, 2 rows left out (line 10:"))
    }

    @Test func theLogbooksOwnFileReadsBackTheSame() throws {
        let json = #"[{"id":1,"flownOn":"2026-10-12","aircraft":"N3429J","aircraftType":"P28A","route":"KDLH KHIB","remarks":"Say \"again\", please","totalHours":1.4,"nightHours":0.5,"crossCountryHours":1.4,"dualHours":1.0,"soloHours":0.4,"instrumentHours":0.3,"dayLandings":2,"nightLandings":1,"toweredLandings":1,"distanceNm":62,"longestLegNm":62,"approaches":2,"holding":true,"tracking":true}]"#
        let entries = try JSONDecoder().decode([LogbookEntry].self, from: Data(json.utf8))
        let back = LogbookCSV.read(LogbookCSV.csv(entries))
        #expect(back.skipped.isEmpty)
        #expect(back.entries == [LogbookEntryRequest(entries[0])])
    }

    @Test func acsCodesFoundInWhatWasPasted() {
        #expect(Endorsing.acsCodes(in: "pa.i.e.k1, PA.I.D.K2 and PA.I.E.K1 again; IR.VII.A.K1a") == ["PA.I.E.K1", "PA.I.D.K2", "IR.VII.A.K1a"])
        let table = try? JSONDecoder().decode(AcsTable.self, from: Data(#"{"editions":["FAA-S-ACS-6C"],"tasks":{"PA.I.E":{"area":"Preflight","task":"Performance"}},"elements":{"PA.I.E.K1":"Density altitude."}}"#.utf8))
        #expect(table?.words("PA.I.E.K1") == "Performance: Density altitude." && table?.words("PA.I.E.K9") == "Performance" && table?.words("PA.IX.A.K1") == nil)
    }

    @Test func theLatestOfEachKindNotVoidedIsInForce() throws {
        let json = #"[{"id":3,"code":"solo","text":"new","signedOn":"2026-10-10","until":null,"voided":true},{"id":2,"code":"solo","text":"older","signedOn":"2026-09-10","until":null,"voided":false},{"id":1,"code":"solo","text":"oldest","signedOn":"2026-08-10","until":null,"voided":false}]"#
        let signed = try JSONDecoder().decode([SignedEndorsement].self, from: Data(json.utf8))
        #expect(Endorsing.inForce(signed)["solo"]?.id == 2)
    }

    @Test func theAirplaneFormCheckedAsTheGatewayChecksIt() {
        var form = AircraftForm()
        #expect(Set(form.problems.keys) == ["tailNumber", "typeDesignator", "cruiseTasKt", "fuelBurnGph"])
        form.tailNumber = " n3429j "; form.typeDesignator = "p28a"; form.cruiseTasKt = "110"; form.fuelBurnGph = "8.5"
        form.cruisePowerPct = "30"; form.equipment = "S D"
        #expect(form.problems["cruisePowerPct"] == "Cruise power must be between 40 and 100%" && form.problems["equipment"] != nil && form.request == nil)
        form.cruisePowerPct = "65"; form.equipment = "sdfgry"
        let r = form.request
        #expect(r?.tailNumber == "N3429J" && r?.typeDesignator == "P28A" && r?.cruisePowerPct == 65 && r?.equipment == "SDFGRY" && r?.usableFuelGal == nil)
    }

    @Test func daysAsThePagesSayThem() {
        #expect(Day.said("2026-10-13") == "13 Oct 2026" && Day.acDay("2026-10-13") == "10-13-2026")
        #expect(Day.current("2026-10-25", today: "2026-10-25") && !Day.current("2026-10-24", today: "2026-10-25") && !Day.current(nil))
        #expect(Day.string(Day.date("2026-02-28")!) == "2026-02-28")
    }

    @Test func squawksStandingAndExperienceAmounts() {
        let open = Squawk(id: 1, reportedOn: "2026-10-01", text: "Strobe", inoperative: true, deferredFor: nil)
        #expect(Deferral.standing(open) == "Inoperative, not deferred")
        #expect(Deferral.standing(Squawk(id: 2, reportedOn: "2026-10-01", text: "Strobe", inoperative: true, deferredFor: "VFR")) == "Deferred for VFR, day and night")
        #expect(Deferral.standing(Squawk(id: 3, reportedOn: "2026-10-01", text: "Seat", inoperative: false)) == nil)
        #expect(ExperienceSection.amount(ExperienceItem(key: "t", label: "Total", rule: "61.109(a)", unit: "h", have: 32.54, need: 40)) == "32.5 of 40 h")
        #expect(ExperienceSection.amount(ExperienceItem(key: "x", label: "Long XC", rule: "61.109(a)(5)(ii)", unit: "flights", have: 1, need: 1, met: true)) == "Done")
    }

    @Test func lostCommsLeavingTheLimitInTheRulesWords() {
        #expect(LostComms.leaveLimit(approachFix: true, efc: "1450Z", eta: "1435Z").hasPrefix("Hold at the clearance limit"))
        #expect(LostComms.leaveLimit(approachFix: false, efc: "", eta: "1435Z").hasSuffix("estimated time of arrival, 1435Z."))
        #expect(LostComms.routes.map(\.key) == ["assigned", "vectored", "expected", "filed"])
    }
}

@MainActor
struct DrillsTests {
    @Test func aCardKnownGoesUpABoxAndAMissedOneComesBack() {
        let deck = Drills.lightGun
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        #expect(deck.cards.count == 12 && Drills.vfrMinimums.cards.count == 11)
        #expect(Drills.due(deck, [:], now: start).count == 12)
        var p = Drills.answered([:], card: deck.cards[0].id, knew: true, now: start)
        #expect(p[deck.cards[0].id]?.box == 2 && p[deck.cards[0].id]?.due == start.addingTimeInterval(Drills.day))
        p = Drills.answered(p, card: deck.cards[1].id, knew: false, now: start)
        #expect(p[deck.cards[1].id]?.box == 1)
        let due = Drills.due(deck, p, now: start)
        // The known one away for a day; the missed one due, after the new ones.
        #expect(due.count == 11 && due.last?.id == deck.cards[1].id)
        #expect(Drills.nextDue(deck, p, now: start) == start.addingTimeInterval(Drills.day))
        // Up to the last box, and no further.
        var top: Drills.Progress = [:]
        for _ in 0..<8 { top = Drills.answered(top, card: "c", knew: true, now: start) }
        #expect(top["c"]?.box == 5 && top["c"]?.due == start.addingTimeInterval(16 * Drills.day))
    }
}

@MainActor
struct DeviceKeptTests {
    @Test func signingOutForgetsThePilotsFiguresAndFavorites() throws {
        let defaults = try #require(UserDefaults(suiteName: "wingtip-tests-\(UUID().uuidString)"))
        defaults.set(Data(), forKey: "figures:N3429J")
        defaults.set(Data(), forKey: "aircraftFavorites")
        defaults.set(true, forKey: "traffic")
        Session.forgetPilot(defaults)
        #expect(defaults.data(forKey: "figures:N3429J") == nil && defaults.data(forKey: "aircraftFavorites") == nil)
        #expect(defaults.bool(forKey: "traffic"))
    }

    @Test func anAirplanesNameAndLine() {
        let plane = TrafficAircraft(hex: "a1b2c3", lat: 46.8, lon: -92.2, callsign: nil, registration: "N3429J", type: "P28A")
        #expect(KeptAirplane.name(plane) == "N3429J")
        #expect(AirplaneRow.line(TrafficAircraft(hex: "x", lat: 0, lon: 0, type: "B738", altitudeFt: 34_960, speedKt: 451.6)) == "B738 · 35,000 ft · 452 kt")
    }
}
