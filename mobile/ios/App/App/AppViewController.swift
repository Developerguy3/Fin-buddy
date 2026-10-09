import Capacitor
class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(FileSourcesPlugin()) }
}
