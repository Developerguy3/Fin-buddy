import Foundation
import UIKit
import UniformTypeIdentifiers
import Capacitor

@objc(FileSourcesPlugin)
public class FileSourcesPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FileSourcesPlugin"
    public let jsName = "FileSources"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "pickFolder", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "listFiles", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise)]
    private var pending: CAPPluginCall?
    @objc func pickFolder(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.pending = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { pending?.reject("Folder selection cancelled."); pending = nil }
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let folder = urls.first else { pending?.reject("Choose a folder."); return }
        let accessed = folder.startAccessingSecurityScopedResource()
        defer { if accessed { folder.stopAccessingSecurityScopedResource() }; pending = nil }
        do { let bookmark = try folder.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil); pending?.resolve(["token": bookmark.base64EncodedString(), "label": folder.lastPathComponent]) }
        catch { pending?.reject("Could not save folder access.", nil, error) }
    }
    private func root(_ call: CAPPluginCall) throws -> URL {
        guard let token = call.getString("token"), let bookmark = Data(base64Encoded: token) else { throw NSError(domain: "FinBuddy", code: 1, userInfo: [NSLocalizedDescriptionKey: "Choose a saved folder."]) }
        var stale = false
        let url = try URL(resolvingBookmarkData: bookmark, options: .withoutUI, relativeTo: nil, bookmarkDataIsStale: &stale)
        if stale { throw NSError(domain: "FinBuddy", code: 2, userInfo: [NSLocalizedDescriptionKey: "Select this source folder again."]) }
        return url
    }
    @objc func listFiles(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let folder = try self.root(call), access = folder.startAccessingSecurityScopedResource()
                defer { if access { folder.stopAccessingSecurityScopedResource() } }
                let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey]
                guard let enumerator = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles]) else { call.reject("Source folder is unavailable."); return }
                var files: [[String: Any]] = []
                for case let url as URL in enumerator {
                    let values = try url.resourceValues(forKeys: Set(keys))
                    if values.isRegularFile == true {
                        if files.count >= 1000 { call.reject("Folder exceeds the 1000-file scan limit."); return }
                        files.append(["path": String(url.path.dropFirst(folder.path.count + 1)), "size": values.fileSize ?? 0, "type": "application/octet-stream"])
                    }
                }
                call.resolve(["files": files])
            } catch { call.reject("Source access expired or the folder is unavailable.", nil, error) }
        }
    }
    @objc func readFile(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let folder = try self.root(call), access = folder.startAccessingSecurityScopedResource()
                defer { if access { folder.stopAccessingSecurityScopedResource() } }
                let url = folder.appendingPathComponent(call.getString("path") ?? "").standardizedFileURL
                guard url.path.hasPrefix(folder.standardizedFileURL.path + "/") else { call.reject("File is outside the selected folder."); return }
                let values = try url.resourceValues(forKeys: [.fileSizeKey])
                guard (values.fileSize ?? 0) <= 50 * 1024 * 1024 else { call.reject("File exceeds the 50 MB reader limit."); return }
                let data = try Data(contentsOf: url, options: .mappedIfSafe)
                call.resolve(["data": data.base64EncodedString()])
            } catch { call.reject("Could not read the selected file.", nil, error) }
        }
    }
}
