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

/// The pill's height, in points: the grabber's strip and the tab bar
/// (SheetContainerViewController's head) over the route's figures.
private let pillHeight: CGFloat = 144

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
        CAPPluginMethod(name: "setDetent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTabs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cover", returnType: CAPPluginReturnPromise)
    ]

    var role: SheetRole = .map

    @objc func ready(_ call: CAPPluginCall) {
        NSLog("NativeSheet: ready from the %@ page", role.rawValue)
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

    /// What the sheet's tab bar shows, as the page's TabBar has it.
    @objc func setTabs(_ call: CAPPluginCall) {
        let tabs: [SheetTab] = (call.getArray("tabs") ?? []).compactMap { entry in
            guard let tab = entry as? JSObject, let value = tab["value"] as? String else { return nil }
            return SheetTab(value: value, label: tab["label"] as? String ?? value)
        }
        let up = call.getString("up") ?? ""
        let card = call.getObject("card").map { card in
            SheetCard(title: card["title"] as? String ?? "", back: card["back"] as? Bool ?? false, close: card["close"] as? Bool ?? false)
        }
        var marks: [String: String] = [:]
        for (tab, mark) in call.getObject("marks") ?? [:] {
            if let mark = mark as? String { marks[tab] = mark }
        }
        DispatchQueue.main.async {
            NativeSheetHub.shared.host?.sheet?.show(tabs: tabs, up: up, card: card, marks: marks)
            call.resolve()
        }
    }

    /// The map's page's own sheet out: iOS's out of its way meanwhile.
    @objc func cover(_ call: CAPPluginCall) {
        let hidden = call.getBool("hidden") ?? false
        DispatchQueue.main.async {
            NativeSheetHub.shared.host?.setSheetHidden(hidden)
            call.resolve()
        }
    }
}

/// A tab of the sheet's bar, by the page's own value for it.
struct SheetTab: Equatable {
    let value: String
    let label: String
}

/// A card's bar in the tabs' place, as the page's TabBar minimizes to:
/// its name, and Back and the close where it has them.
struct SheetCard {
    let title: String
    let back: Bool
    let close: Bool
}

/// Tells a page which of the two it is before any of its scripts run. Put
/// in the web view's own content controller once the bridge has made it:
/// the bridge swaps the configuration's controller for its own, so a
/// script added to the configuration is lost.
private func tellRole(_ role: SheetRole, to webView: WKWebView?) {
    let script = WKUserScript(source: "window.WingtipNativeRole = '\(role.rawValue)';", injectionTime: .atDocumentStart, forMainFrameOnly: true)
    webView?.configuration.userContentController.addUserScript(script)
}

/// The sheet's web view: the site's panel alone, clear, so the sheet's
/// own glass is its background.
class SheetBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        let plugin = NativeSheetPlugin()
        plugin.role = .sheet
        bridge?.registerPluginInstance(plugin)
        tellRole(.sheet, to: webView)
        webView?.isOpaque = false
        webView?.backgroundColor = .clear
        webView?.scrollView.backgroundColor = .clear
    }

}

/// The sheet: its tab bar in Swift at its head, at the owner's ask ("I
/// also want the tabs icon and selector to be in swift") -- each tab an
/// SF Symbol over its name, the one up in the tint inside a capsule that
/// slides to the tab picked, as iOS's tab bar draws it -- and the panel's
/// web view under it. UIKit's own UITabBar, standing alone outside a tab
/// bar controller, laid each tab's icon over its name in the sheet (three
/// recordings' frames), so the bar is buttons of its own. With a card open
/// over the tab, the bar is the card's instead, as the page's was: Back,
/// the card's name (a tap shows the tabs), and the close. What is done on
/// either goes to the page, whose TabBar acts on it as on its own taps
/// (web/src/lib/nativeSheet's useNativeTabs).
final class SheetContainerViewController: UIViewController {
    let bridgeController = SheetBridgeViewController()
    private let tabsView = UIView()
    private let capsule = UIView()
    private let stack = UIStackView()
    private var buttons: [UIButton] = []
    private let cardBar = UIView()
    private let backButton = UIButton(type: .system)
    private let titleButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private var tabs: [SheetTab] = []
    private var up: String = ""

    /// Clear of iOS's grabber, five points in from the sheet's edge, as
    /// Maps' search bar is.
    private static let headTop: CGFloat = 14
    private static let headHeight: CGFloat = 56

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear

        addChild(bridgeController)
        let web: UIView = bridgeController.view
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        bridgeController.didMove(toParent: self)

        let head = UIView()
        head.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(head)

        tabsView.translatesAutoresizingMaskIntoConstraints = false
        head.addSubview(tabsView)
        capsule.backgroundColor = UIColor.secondarySystemFill
        capsule.layer.cornerCurve = .continuous
        capsule.isUserInteractionEnabled = false
        tabsView.addSubview(capsule)
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.translatesAutoresizingMaskIntoConstraints = false
        tabsView.addSubview(stack)

        cardBar.translatesAutoresizingMaskIntoConstraints = false
        cardBar.isHidden = true
        head.addSubview(cardBar)
        round(backButton, symbol: "chevron.left", label: "Back")
        round(closeButton, symbol: "xmark", label: "Close")
        titleButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        titleButton.titleLabel?.adjustsFontForContentSizeCategory = true
        for button in [backButton, titleButton, closeButton] {
            button.translatesAutoresizingMaskIntoConstraints = false
            cardBar.addSubview(button)
        }
        backButton.addAction(UIAction { [weak self] _ in self?.send("back") }, for: .touchUpInside)
        titleButton.addAction(UIAction { [weak self] _ in self?.send("show") }, for: .touchUpInside)
        closeButton.addAction(UIAction { [weak self] _ in self?.send("close") }, for: .touchUpInside)

        NSLayoutConstraint.activate([
            head.topAnchor.constraint(equalTo: view.topAnchor, constant: Self.headTop),
            head.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            head.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            head.heightAnchor.constraint(equalToConstant: Self.headHeight),
            tabsView.topAnchor.constraint(equalTo: head.topAnchor),
            tabsView.bottomAnchor.constraint(equalTo: head.bottomAnchor),
            tabsView.leadingAnchor.constraint(equalTo: head.leadingAnchor),
            tabsView.trailingAnchor.constraint(equalTo: head.trailingAnchor),
            stack.topAnchor.constraint(equalTo: tabsView.topAnchor),
            stack.bottomAnchor.constraint(equalTo: tabsView.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: tabsView.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: tabsView.trailingAnchor),
            cardBar.topAnchor.constraint(equalTo: head.topAnchor),
            cardBar.bottomAnchor.constraint(equalTo: head.bottomAnchor),
            cardBar.leadingAnchor.constraint(equalTo: head.leadingAnchor),
            cardBar.trailingAnchor.constraint(equalTo: head.trailingAnchor),
            backButton.leadingAnchor.constraint(equalTo: cardBar.leadingAnchor, constant: 4),
            backButton.centerYAnchor.constraint(equalTo: cardBar.centerYAnchor),
            backButton.widthAnchor.constraint(equalToConstant: 36),
            backButton.heightAnchor.constraint(equalToConstant: 36),
            closeButton.trailingAnchor.constraint(equalTo: cardBar.trailingAnchor, constant: -4),
            closeButton.centerYAnchor.constraint(equalTo: cardBar.centerYAnchor),
            closeButton.widthAnchor.constraint(equalToConstant: 36),
            closeButton.heightAnchor.constraint(equalToConstant: 36),
            titleButton.centerXAnchor.constraint(equalTo: cardBar.centerXAnchor),
            titleButton.centerYAnchor.constraint(equalTo: cardBar.centerYAnchor),
            titleButton.leadingAnchor.constraint(greaterThanOrEqualTo: backButton.trailingAnchor, constant: 8),
            titleButton.trailingAnchor.constraint(lessThanOrEqualTo: closeButton.leadingAnchor, constant: -8),
            web.topAnchor.constraint(equalTo: head.bottomAnchor, constant: 4),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        placeCapsule(animated: false)
    }

    /// A round button of the sheet's, its glyph a symbol, as the page's
    /// BackButton and CloseButton are: 36 points.
    private func round(_ button: UIButton, symbol: String, label: String) {
        var configuration = UIButton.Configuration.gray()
        configuration.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold))
        configuration.cornerStyle = .capsule
        button.configuration = configuration
        button.accessibilityLabel = label
    }

    /// The symbol for a tab of the planner's, as the page's lucide icon
    /// draws it; a tab of another page's (the dev page's) a plain one.
    private func symbol(for tab: String) -> String {
        switch tab {
        case "fpl": return "point.topleft.down.curvedto.point.bottomright.up"
        case "airport": return "antenna.radiowaves.left.and.right"
        case "aircraft": return "airplane"
        case "setup": return "gearshape"
        default: return "circle"
        }
    }

    /// A tab: its symbol over its name, 11 points, as iOS's tab bar sets
    /// them, the tint on the one up.
    private func tabButton(_ tab: SheetTab) -> UIButton {
        var configuration = UIButton.Configuration.plain()
        configuration.image = UIImage(systemName: symbol(for: tab.value), withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .medium))
        configuration.imagePlacement = .top
        configuration.imagePadding = 3
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 2, bottom: 4, trailing: 2)
        var title = AttributedString(tab.label)
        title.font = UIFont.systemFont(ofSize: 11, weight: .semibold)
        configuration.attributedTitle = title
        let button = UIButton(configuration: configuration)
        button.accessibilityLabel = tab.label
        button.addAction(UIAction { [weak self] _ in self?.tapped(tab.value) }, for: .touchUpInside)
        return button
    }

    func show(tabs next: [SheetTab], up nextUp: String, card: SheetCard?, marks: [String: String]) {
        loadViewIfNeeded()
        if next != tabs {
            tabs = next
            buttons.forEach { $0.removeFromSuperview() }
            buttons = next.map(tabButton)
            buttons.forEach { stack.addArrangedSubview($0) }
            view.layoutIfNeeded()
        }
        for (index, button) in buttons.enumerated() where index < tabs.count {
            let value = tabs[index].value
            let selected = value == nextUp
            button.tintColor = selected ? view.tintColor : .label
            button.accessibilityTraits = selected ? [.button, .selected] : [.button]
            // A tab's mark, as the page's red or amber dot.
            let mark = marks[value]
            button.configuration?.subtitle = nil
            button.accessibilityValue = mark == "stop" ? "Warning" : mark == "caution" ? "Caution" : nil
            if let mark {
                button.configuration?.image = UIImage(systemName: symbol(for: value), withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .medium))?
                    .withTintColor(mark == "stop" ? .systemRed : .systemOrange, renderingMode: .alwaysOriginal)
            }
        }
        let moved = nextUp != up
        up = nextUp
        placeCapsule(animated: moved)
        tabsView.isHidden = card != nil
        cardBar.isHidden = card == nil
        if let card {
            titleButton.setTitle(card.title, for: .normal)
            backButton.isHidden = !card.back
            closeButton.isHidden = !card.close
        }
    }

    /// The capsule behind the tab up, sliding to it.
    private func placeCapsule(animated: Bool) {
        guard let index = tabs.firstIndex(where: { $0.value == up }), index < buttons.count else {
            capsule.isHidden = true
            return
        }
        capsule.isHidden = false
        let frame = buttons[index].convert(buttons[index].bounds, to: tabsView).insetBy(dx: 2, dy: 2)
        capsule.layer.cornerRadius = frame.height / 2
        if animated {
            UIView.animate(withDuration: 0.3, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0) { self.capsule.frame = frame }
        } else {
            capsule.frame = frame
        }
    }

    private func tapped(_ tab: String) {
        NativeSheetHub.shared.sheet?.notifyListeners("tabAction", data: ["action": "tap", "tab": tab])
    }

    /// A tab tapped, as a finger would, for the build's own recording.
    func demoTap(_ tab: String) {
        tapped(tab)
    }

    private func send(_ action: String) {
        NativeSheetHub.shared.sheet?.notifyListeners("tabAction", data: ["action": action])
    }
}

/// The app's web view, the map, with the app's own plugins registered
/// beside the packages' (Gdl90Plugin, NativeSheetPlugin), and the sheet
/// over it once its page is ready for one.
class MainViewController: CAPBridgeViewController, UISheetPresentationControllerDelegate {
    private(set) var sheet: SheetContainerViewController?

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(Gdl90Plugin())
        let plugin = NativeSheetPlugin()
        plugin.role = .map
        bridge?.registerPluginInstance(plugin)
        tellRole(.map, to: webView)
        NativeSheetHub.shared.host = self
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
        NSLog("NativeSheet: present (sheet %@, presented %@)", self.sheet == nil ? "none" : "already", presentedViewController == nil ? "none" : String(describing: presentedViewController))
        guard self.sheet == nil, presentedViewController == nil else { return }
        let sheet = SheetContainerViewController()
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
        self.sheet = sheet
        present(sheet, animated: true) {
            self.reportDetent()
            self.playDemoIfAsked()
        }
    }

    /// The sheet to a size by name, as a page asks for one.
    func select(detent: String, animated: Bool) {
        guard let controller = sheet?.sheetPresentationController else { return }
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
        guard let sheet, let controller = sheet.sheetPresentationController else { return }
        let hub = NativeSheetHub.shared
        let selected = controller.selectedDetentIdentifier
        hub.detent = selected == .large ? "large" : selected == .pill ? "pill" : "medium"
        let top = sheet.view.convert(sheet.view.bounds, to: view).minY
        hub.height = max(0, view.bounds.height - top)
        hub.map?.notifyListeners("detent", data: hub.detentData)
        hub.sheet?.notifyListeners("detent", data: hub.detentData)
    }

    /// The sheet out of sight and out of the way of a finger while the
    /// map's page has a sheet of its own out (lib/nativeSheet's
    /// holdNativeSheetAway), and back after it.
    func setSheetHidden(_ hidden: Bool) {
        guard let container = sheet?.presentationController?.containerView else { return }
        UIView.animate(withDuration: 0.25) { container.alpha = hidden ? 0 : 1 }
        container.isUserInteractionEnabled = !hidden
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
        // Then each tab in turn from the bar, and back to FPL.
        let tabs = ["airport", "aircraft", "setup", "fpl"]
        for (index, tab) in tabs.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0 * Double(steps.count + index + 1)) {
                self.sheet?.demoTap(tab)
            }
        }
    }
}
