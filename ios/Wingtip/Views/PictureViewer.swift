import SwiftUI
import UIKit

/// The planner's pictures kept for the session, so a card opened again,
/// or the full-screen view of a thumbnail, does not ask a second time.
enum PictureCache {
    private static let kept = NSCache<NSString, UIImage>()

    static func image(_ path: String) async throws -> UIImage {
        if let image = kept.object(forKey: path as NSString) { return image }
        let data = try await Planner.picture(path)
        guard let image = UIImage(data: data) else { throw Planner.Failure(status: 200, detail: "The picture could not be read.") }
        kept.setObject(image, forKey: path as NSString)
        return image
    }

    /// Several, in their order: a chart's few pages one after another.
    static func images(_ paths: [String]) async throws -> [UIImage] {
        var found: [UIImage] = []
        for path in paths { found.append(try await image(path)) }
        return found
    }
}

/// A picture of the planner's in a box, filled, a placeholder while it
/// comes and a glyph where it could not be had.
struct RemotePicture: View {
    let path: String
    var fit = false
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let image {
                if fit {
                    Image(uiImage: image).resizable().scaledToFit()
                } else {
                    Image(uiImage: image).resizable().scaledToFill()
                }
            } else if failed {
                Image(systemName: "photo").font(.title2).foregroundStyle(.secondary)
            } else {
                ProgressView()
            }
        }
        .task(id: path) {
            failed = false
            do { image = try await PictureCache.image(path) } catch { image = nil; failed = true }
        }
    }
}

/// A picture to show full screen: what it is, how its pages are had,
/// and the credit its licence asks for.
struct ShownPicture: Identifiable {
    let id = UUID()
    let title: String
    var credit: String?
    let load: () async throws -> [UIImage]

    /// The planner's pictures by their paths.
    static func paths(_ title: String, _ paths: [String], credit: String? = nil) -> ShownPicture {
        ShownPicture(title: title, credit: credit) { try await PictureCache.images(paths) }
    }

    /// One of the FAA's charts by its address, its pages drawn by the
    /// planner (/api/faa-chart): a plate, the diagram, the Chart
    /// Supplement's pages for the field.
    static func faaChart(_ title: String, url: String, airport: String) -> ShownPicture {
        ShownPicture(title: title) {
            let pages = try await Planner.faaChart(url: url, airport: airport)
            guard !pages.isEmpty else { throw Planner.Failure(status: 404, detail: "The FAA's chart has no page for \(airport).") }
            return try await PictureCache.images(pages.map(\.path))
        }
    }
}

/// A chart or a photo full screen to pinch in on, as Files shows a page:
/// its title at the top and the close at the right, which goes back.
struct PictureViewer: View {
    let picture: ShownPicture
    @Environment(\.dismiss) private var dismiss
    @State private var images: [UIImage]?
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Group {
                if let images {
                    ZoomablePictures(images: images)
                        .ignoresSafeArea(edges: .bottom)
                } else if let problem {
                    ContentUnavailableView {
                        Label("Not shown", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(problem)
                    } actions: {
                        Button("Try Again") { Task { await load() } }
                    }
                } else {
                    ProgressView("Fetching…")
                }
            }
            .navigationTitle(picture.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }
                        .accessibilityLabel("Close")
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let credit = picture.credit, images != nil {
                    Text(credit).font(.caption2).foregroundStyle(.secondary)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(.thinMaterial, in: Capsule())
                        .padding(.bottom, 8)
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        problem = nil
        do { images = try await picture.load() } catch { problem = error.localizedDescription }
    }
}

/// The pages one under another in a scroll view that pinches and
/// double-taps to zoom, as UIKit's own does it best.
struct ZoomablePictures: UIViewRepresentable {
    let images: [UIImage]

    func makeUIView(context: Context) -> PagesScrollView {
        let view = PagesScrollView()
        view.images = images
        return view
    }

    func updateUIView(_ view: PagesScrollView, context: Context) {
        if !view.images.elementsEqual(images, by: ===) { view.images = images }
    }
}

final class PagesScrollView: UIScrollView, UIScrollViewDelegate {
    private let container = UIView()
    private var laidWidth: CGFloat = 0
    static let gap: CGFloat = 8

    var images: [UIImage] = [] {
        didSet {
            container.subviews.forEach { $0.removeFromSuperview() }
            for image in images {
                let page = UIImageView(image: image)
                page.contentMode = .scaleAspectFit
                page.backgroundColor = .white
                container.addSubview(page)
            }
            laidWidth = 0
            setNeedsLayout()
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        delegate = self
        minimumZoomScale = 1
        maximumZoomScale = 8
        bouncesZoom = true
        showsHorizontalScrollIndicator = false
        backgroundColor = .systemBackground
        addSubview(container)
        let twice = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        twice.numberOfTapsRequired = 2
        addGestureRecognizer(twice)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    /// The pages the view's width, one under another, laid again when
    /// the width changes (a turn of the phone).
    override func layoutSubviews() {
        super.layoutSubviews()
        let width = bounds.width
        if width > 0, width != laidWidth {
            laidWidth = width
            if zoomScale != 1 { zoomScale = 1 }
            var y: CGFloat = 0
            for case let page as UIImageView in container.subviews {
                let size = page.image?.size ?? .zero
                let height = size.width > 0 ? width * size.height / size.width : 0
                page.frame = CGRect(x: 0, y: y, width: width, height: height)
                y += height + Self.gap
            }
            container.frame = CGRect(x: 0, y: 0, width: width, height: max(0, y - Self.gap))
            contentSize = container.frame.size
        }
        centre()
    }

    /// A page shorter than the screen sits in its middle, as Photos'.
    private func centre() {
        let spare = max(0, (bounds.height - safeAreaInsets.top - safeAreaInsets.bottom - contentSize.height) / 2)
        if contentInset.top != spare { contentInset = UIEdgeInsets(top: spare, left: 0, bottom: spare, right: 0) }
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { container }

    func scrollViewDidZoom(_ scrollView: UIScrollView) { centre() }

    @objc private func doubleTapped(_ tap: UITapGestureRecognizer) {
        if zoomScale > 1.01 {
            setZoomScale(1, animated: true)
        } else {
            let at = tap.location(in: container)
            let size = CGSize(width: bounds.width / 3, height: bounds.height / 3)
            zoom(to: CGRect(x: at.x - size.width / 2, y: at.y - size.height / 2, width: size.width, height: size.height), animated: true)
        }
    }
}
