import UIKit
import WebKit
import Capacitor

/// The map's panel as iOS's own sheet, as Apple Maps' is, at the owner's
/// ask ("I want the bottom sheet to be iOS native sheet so that it works
/// like Apple Maps. Other things can be wrapped around", 2026-10-18):
/// UISheetPresentationController's detents, drag, flick, grabber and
/// Liquid Glass, holding the site's own panel. The site runs twice: the
/// app's web view draws the map alone, and a second one in the sheet draws
/// the panel alone (web/src/lib/nativeSheet, told which by
/// `window.WingtipNativeRole`). The two are kept in step through the
/// address, which holds the route and what is picked on it, and the
/// sheet's detent is the panel's size: its pill, half way and all the way
/// up. The sheet is shown only once the map's page says it can work this
/// way (`ready`), so a site from before it is the one web view as it was.

/// Which of the two web views a page is.
enum SheetRole: String {
    case map, sheet
}

extension UISheetPresentationController.Detent.Identifier {
    /// The panel at rest: its tabs and the route's figures, as Maps' sheet
    /// rests at its search bar.
    static let pill = UISheetPresentationController.Detent.Identifier("pill")
}

/// The pill's height, in points: the panel's capsule (MapPanel's tabs
/// over the route's figures) and the grabber's strip over it.
private let pillHeight: CGFloat = 132

/// The two web views' plugins and the sheet's host, met here: the address
/// one changes is handed to the other, and the sheet's size to both.
final class NativeSheetHub {
    static let shared = NativeSheetHub()
    weak var map: NativeSheetPlugin?
    weak var sheet: NativeSheetPlugin?
    weak var host: MainViewController?
    /// The address's query last sent, for the sheet's page as it comes.
    var lastSearch: String?
    var detent = "medium"
    var height: CGFloat = 0

    func other(than role: SheetRole) -> NativeSheetPlugin? {
        role == .map ? sheet : map
    }

    var detentData: [String: Any] {
        ["detent": detent, "height": height]
    }
}

/// The page's way to the sheet: that it is ready, the address it has
/// moved to, and the size it wants the sheet at (a card opening half way,
/// a list all the way up). It is told the other page's address ("url")
/// and the sheet's size ("detent") in turn.
@objc(NativeSheetPlugin)
public class NativeSheetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeSheetPlugin"
    public let jsName = "NativeSheet"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ready", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDetent", returnType: CAPPluginReturnPromise)
    ]

    var role: SheetRole = .map

    @objc func ready(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let hub = NativeSheetHub.shared
            switch self.role {
            case .map:
                hub.map = self
                hub.host?.presentSheet()
            case .sheet:
                hub.sheet = self
                if let search = hub.lastSearch {
                    self.notifyListeners("url", data: ["search": search])
                }
                self.notifyListeners("detent", data: hub.detentData)
            }
            call.resolve(["role": self.role.rawValue])
        }
    }

    @objc func syncUrl(_ call: CAPPluginCall) {
        let search = call.getString("search") ?? ""
        DispatchQueue.main.async {
            let hub = NativeSheetHub.shared
            hub.lastSearch = search
            hub.other(than: self.role)?.notifyListeners("url", data: ["search": search])
            call.resolve()
        }
    }

    @objc func setDetent(_ call: CAPPluginCall) {
        let detent = call.getString("detent") ?? "medium"
        DispatchQueue.main.async {
            NativeSheetHub.shared.host?.select(detent: detent, animated: true)
            call.resolve()
        }
    }
}

/// Tells a page which of the two it is before any of its scripts run.
private func roleScript(_ role: SheetRole) -> WKUserScript {
    WKUserScript(source: "window.WingtipNativeRole = '\(role.rawValue)';", injectionTime: .atDocumentStart, forMainFrameOnly: true)
}

/// The sheet's web view: the site's panel alone, clear, so the sheet's
/// own glass is its background.
class SheetViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        let plugin = NativeSheetPlugin()
        plugin.role = .sheet
        bridge?.registerPluginInstance(plugin)
        webView?.isOpaque = false
        webView?.backgroundColor = .clear
        webView?.scrollView.backgroundColor = .clear
    }

    override open func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.userContentController.addUserScript(roleScript(.sheet))
        return configuration
    }
}

/// The app's web view, the map, with the app's own plugins registered
/// beside the packages' (Gdl90Plugin, NativeSheetPlugin), and the sheet
/// over it once its page is ready for one.
class MainViewController: CAPBridgeViewController, UISheetPresentationControllerDelegate {
    private var sheetController: SheetViewController?

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(Gdl90Plugin())
        let plugin = NativeSheetPlugin()
        plugin.role = .map
        bridge?.registerPluginInstance(plugin)
        NativeSheetHub.shared.host = self
    }

    override open func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.userContentController.addUserScript(roleScript(.map))
        return configuration
    }

    /// The pill, half way and all the way up, as Maps' sheet has them; on
    /// iOS 15, which has no detent of its own size, half way and up.
    private var detents: [UISheetPresentationController.Detent] {
        if #available(iOS 16.0, *) {
            return [.custom(identifier: .pill) { _ in pillHeight }, .medium(), .large()]
        }
        return [.medium(), .large()]
    }

    /// The sheet, once: never put away (it is the panel), never shading
    /// the map at any size, and the map under it answering a finger.
    func presentSheet() {
        guard sheetController == nil, presentedViewController == nil else { return }
        let sheet = SheetViewController()
        sheet.isModalInPresentation = true
        if let controller = sheet.sheetPresentationController {
            controller.detents = detents
            controller.largestUndimmedDetentIdentifier = .large
            controller.prefersGrabberVisible = true
            controller.prefersScrollingExpandsWhenScrolledToEdge = true
            controller.prefersEdgeAttachedInCompactHeight = true
            controller.selectedDetentIdentifier = .medium
            controller.delegate = self
        }
        sheetController = sheet
        present(sheet, animated: true) {
            self.reportDetent()
            self.playDemoIfAsked()
        }
    }

    /// The sheet to a size by name, as a page asks for one.
    func select(detent: String, animated: Bool) {
        guard let controller = sheetController?.sheetPresentationController else { return }
        let identifier: UISheetPresentationController.Detent.Identifier
        switch detent {
        case "large": identifier = .large
        case "pill":
            if #available(iOS 16.0, *) { identifier = .pill } else { identifier = .medium }
        default: identifier = .medium
        }
        guard controller.selectedDetentIdentifier != identifier else { return }
        if animated {
            controller.animateChanges { controller.selectedDetentIdentifier = identifier }
        } else {
            controller.selectedDetentIdentifier = identifier
        }
        // Said once it has come to rest there, its height measured then.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { self.reportDetent() }
    }

    func sheetPresentationControllerDidChangeSelectedDetentIdentifier(_ sheetPresentationController: UISheetPresentationController) {
        reportDetent()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { self.reportDetent() }
    }

    /// The sheet's size to both pages: its name for the panel, its height
    /// for the map to fit a route clear of it.
    private func reportDetent() {
        guard let sheet = sheetController, let controller = sheet.sheetPresentationController else { return }
        let hub = NativeSheetHub.shared
        let selected = controller.selectedDetentIdentifier
        hub.detent = selected == .large ? "large" : selected == .pill ? "pill" : "medium"
        let top = sheet.view.convert(sheet.view.bounds, to: view).minY
        hub.height = max(0, view.bounds.height - top)
        hub.map?.notifyListeners("detent", data: hub.detentData)
        hub.sheet?.notifyListeners("detent", data: hub.detentData)
    }

    /// For the build's own recording (ios.yml's sheet demo): with
    /// `-NativeSheetDemo` among the launch arguments, the sheet goes
    /// through its sizes by itself, as a finger would take it.
    private func playDemoIfAsked() {
        guard ProcessInfo.processInfo.arguments.contains("-NativeSheetDemo") else { return }
        let steps = ["pill", "medium", "large", "medium", "pill", "medium"]
        for (index, detent) in steps.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0 * Double(index + 1)) {
                self.select(detent: detent, animated: true)
            }
        }
    }
}
