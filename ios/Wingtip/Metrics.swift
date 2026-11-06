import Foundation
import MetricKit
import os

/// The app's own measurements from the phones that run it, as Apple
/// delivers them (MetricKit): launch times, hangs, battery and the
/// cellular and Wi-Fi traffic of each day, and a diagnostic for each
/// crash, hang and disk-write exception, without a third-party kit. The
/// payloads are written to the system log, where Xcode's Organizer and
/// a device's sysdiagnose show them, with the figures the owner steers
/// by: the launch time at the 50th and 95th percentile, the hang time
/// and the energy (the owner's ask for a fast app, measured, 2026-11-03).
/// The owner's Mac cannot run a current Xcode, so these and the runner's
/// performance tests are the numbers, not Instruments traces.
@MainActor
final class Metrics: NSObject, MXMetricManagerSubscriber {
    static let shared = Metrics()
    private let log = Log.metrics
    private var started = false

    /// Subscribed once, at launch: MetricKit delivers a payload about once
    /// a day, for the previous day, and any diagnostics as they come.
    func start() {
        guard !started else { return }
        started = true
        MXMetricManager.shared.add(self)
    }

    nonisolated func didReceive(_ payloads: [MXMetricPayload]) {
        for payload in payloads {
            // The whole payload as JSON, so nothing Apple measures is lost,
            // and the three figures that matter as a line of their own.
            let launch = payload.applicationLaunchMetrics?.histogrammedTimeToFirstDraw
            let hang = payload.applicationResponsivenessMetrics?.histogrammedApplicationHangTime
            let summary = "launch p50/p95 \(Self.percentiles(launch)); hang \(Self.total(hang)); cpu \(payload.cpuMetrics?.cumulativeCPUTime.description ?? "?")"
            Task { @MainActor in
                self.log.notice("metrics \(payload.timeStampBegin, privacy: .public) to \(payload.timeStampEnd, privacy: .public): \(summary, privacy: .public)")
                self.log.debug("\(String(decoding: payload.jsonRepresentation(), as: UTF8.self), privacy: .public)")
            }
        }
    }

    nonisolated func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for payload in payloads {
            let crashes = payload.crashDiagnostics?.count ?? 0
            let hangs = payload.hangDiagnostics?.count ?? 0
            Task { @MainActor in
                self.log.error("diagnostics \(payload.timeStampBegin, privacy: .public): \(crashes) crashes, \(hangs) hangs")
                self.log.debug("\(String(decoding: payload.jsonRepresentation(), as: UTF8.self), privacy: .public)")
            }
        }
    }

    /// A histogram's 50th and 95th percentile, in milliseconds, from its
    /// buckets: MetricKit gives the counts per bucket, not the samples.
    private nonisolated static func percentiles(_ histogram: MXHistogram<UnitDuration>?) -> String {
        guard let histogram else { return "?" }
        var buckets: [(upper: Double, count: Int)] = []
        var total = 0
        for bucket in histogram.bucketEnumerator {
            guard let bucket = bucket as? MXHistogramBucket<UnitDuration> else { continue }
            buckets.append((bucket.bucketEnd.converted(to: .milliseconds).value, bucket.bucketCount))
            total += bucket.bucketCount
        }
        guard total > 0 else { return "none" }
        func at(_ share: Double) -> String {
            var seen = 0
            for bucket in buckets {
                seen += bucket.count
                if Double(seen) / Double(total) >= share { return "\(Int(bucket.upper)) ms" }
            }
            return "\(Int(buckets.last?.upper ?? 0)) ms"
        }
        return "\(at(0.5)) / \(at(0.95))"
    }

    /// A histogram's total time, in seconds, bucket ends by their counts.
    private nonisolated static func total(_ histogram: MXHistogram<UnitDuration>?) -> String {
        guard let histogram else { return "?" }
        var seconds = 0.0
        for bucket in histogram.bucketEnumerator {
            guard let bucket = bucket as? MXHistogramBucket<UnitDuration> else { continue }
            seconds += bucket.bucketEnd.converted(to: .seconds).value * Double(bucket.bucketCount)
        }
        return "\(Formats.number(seconds, decimals: 1)) s"
    }
}
