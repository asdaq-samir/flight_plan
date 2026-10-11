import Foundation
import Network
import Capacitor

/// A cockpit ADS-B receiver's GDL 90 over Wi-Fi -- Stratux, SkyEcho,
/// Sentry -- heard as UDP datagrams on its port (4000) and handed to the
/// page as they come, base64, which reads them (web/src/lib/map/receiver,
/// lib/gdl90). A web page cannot receive UDP; the app can, with iOS's
/// local network permission (Info.plist's NSLocalNetworkUsageDescription).
/// A receiver that sends to the network's broadcast address rather than
/// to each phone needs Apple's multicast networking entitlement as well
/// (docs/IOS.md).
@objc(Gdl90Plugin)
public class Gdl90Plugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "Gdl90Plugin"
    public let jsName = "Gdl90"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var listener: NWListener?
    private let queue = DispatchQueue(label: "app.wingtipmaps.gdl90")

    @objc func start(_ call: CAPPluginCall) {
        let port = call.getInt("port") ?? 4000
        queue.async {
            if self.listener != nil {
                call.resolve()
                return
            }
            guard let endpointPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
                call.reject("Not a port: \(port)")
                return
            }
            do {
                let parameters = NWParameters.udp
                parameters.allowLocalEndpointReuse = true
                let listener = try NWListener(using: parameters, on: endpointPort)
                // Each sender is a connection of its own: its datagrams read
                // one after another for as long as it sends.
                listener.newConnectionHandler = { [weak self] connection in
                    guard let self = self else { return }
                    connection.start(queue: self.queue)
                    self.receive(on: connection)
                }
                listener.stateUpdateHandler = { [weak self] state in
                    if case .failed(let error) = state {
                        self?.notifyListeners("error", data: ["message": error.localizedDescription])
                    }
                }
                listener.start(queue: self.queue)
                self.listener = listener
                call.resolve()
            } catch {
                call.reject("Could not listen on port \(port): \(error.localizedDescription)")
            }
        }
    }

    private func receive(on connection: NWConnection) {
        connection.receiveMessage { [weak self] data, _, _, error in
            if let data = data, !data.isEmpty {
                self?.notifyListeners("packet", data: ["data": data.base64EncodedString()])
            }
            if error == nil {
                self?.receive(on: connection)
            } else {
                connection.cancel()
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        queue.async {
            self.listener?.cancel()
            self.listener = nil
            call.resolve()
        }
    }
}

/// The app's web view, with the app's own plugin registered beside the
/// packages' (Gdl90Plugin).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(Gdl90Plugin())
    }
}
