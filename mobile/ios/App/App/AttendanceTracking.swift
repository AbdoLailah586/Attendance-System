import Foundation
import CoreLocation
import Security
import UIKit
import Capacitor
import BackgroundTasks

// All state changes run on the main queue. The native queue survives a WebView
// suspension, app restart, and network failures. Tokens live in the Keychain.
final class AttendanceEngine: NSObject, CLLocationManagerDelegate {
    static let shared = AttendanceEngine()
    let manager = CLLocationManager()
    let prefs = UserDefaults.standard
    let api = URL(string: "https://attendance-system-joe-2026.vercel.app/api/attendance/ping")!
    private var queue: [[String: Any]] = []
    private var uploading = false
    private var startCall: CAPPluginCall?
    private var timeout: DispatchWorkItem?
    private var lastRecorded: Date = .distantPast
    private var queueError = ""
    private var backgroundTask: BGProcessingTask?
    private var queueURL: URL {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return directory.appendingPathComponent("attendance-events.json")
    }
    var active: Bool { prefs.bool(forKey: "attendance-active") }
    var user: [String: Any]? {
        guard let data = prefs.data(forKey: "attendance-user") else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
    var userID: Int { user?["id"] as? Int ?? 0 }
    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        manager.pausesLocationUpdatesAutomatically = false
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        do {
            if FileManager.default.fileExists(atPath: queueURL.path) {
                guard let saved = try JSONSerialization.jsonObject(with: Data(contentsOf: queueURL)) as? [[String: Any]] else { throw NSError(domain: "AttendanceQueue", code: 1) }
                queue = saved
            }
        } catch { queueError = "تعذر قراءة الأحداث المحفوظة؛ افتح التطبيق بعد فتح قفل الهاتف" }
        if active && manager.authorizationStatus == .authorizedAlways { resume() }
    }
    private var keyQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "joestore.attendance", kSecAttrAccount as String: "session"]
    }
    func token() -> String {
        var query = keyQuery
        query[kSecReturnData as String] = true
        var data: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &data) == errSecSuccess, let bytes = data as? Data else { return "" }
        return String(data: bytes, encoding: .utf8) ?? ""
    }
    func configure(token: String, userString: String) throws {
        guard let data = userString.data(using: .utf8), let identity = try JSONSerialization.jsonObject(with: data) as? [String: Any], let id = identity["id"] as? Int, !token.isEmpty else { throw problem("جلسة غير صالحة") }
        if (active || !queue.isEmpty) && id != userID { throw problem("أنهِ الشيفت وزامن الأحداث قبل تبديل الحساب") }
        let update = [kSecValueData as String: Data(token.utf8)]
        var result = SecItemUpdate(keyQuery as CFDictionary, update as CFDictionary)
        if result == errSecItemNotFound {
            var add = keyQuery
            add[kSecValueData as String] = Data(token.utf8)
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            result = SecItemAdd(add as CFDictionary, nil)
        }
        guard result == errSecSuccess else { throw problem("تعذر حفظ الجلسة بأمان") }
        prefs.set(data, forKey: "attendance-user")
        prefs.removeObject(forKey: "attendance-error")
    }
    private func problem(_ message: String) -> NSError { NSError(domain: "Attendance", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    private func persist(_ events: [[String: Any]]) throws {
        if !queueError.isEmpty { throw problem(queueError) }
        let directory = queueURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: events).write(to: queueURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var excluded = queueURL
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
        queue = events
        if !queue.isEmpty { scheduleUpload() }
    }
    private func record(type: String, location: CLLocation?) throws {
        guard userID > 0 else { throw problem("سجل الدخول أولًا") }
        let event: [String: Any] = [
            "user_id": userID, "client_event_id": UUID().uuidString.lowercased(),
            "recorded_at": ISO8601DateFormatter().string(from: Date()), "event_type": type,
            "lat": location.map { $0.coordinate.latitude as Any } ?? NSNull(),
            "lng": location.map { $0.coordinate.longitude as Any } ?? NSNull(),
            "accuracy": location.map { $0.horizontalAccuracy as Any } ?? NSNull()
        ]
        try persist(queue + [event])
    }
    func start(_ call: CAPPluginCall) {
        guard startCall == nil else { call.reject("انتظر التقاط GPS"); return }
        guard user?["role"] as? String == "employee" else { call.reject("حساب موظف مطلوب"); return }
        if active { call.resolve(); return }
        guard CLLocationManager.locationServicesEnabled() else { call.reject("شغّل خدمات الموقع"); return }
        startCall = call
        let work = DispatchWorkItem { [weak self] in self?.failStart("اسمح بالموقع دائمًا والتقط GPS ثم حاول مرة أخرى") }
        timeout = work; DispatchQueue.main.asyncAfter(deadline: .now() + 40, execute: work)
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse: manager.requestAlwaysAuthorization()
        case .authorizedAlways: manager.startUpdatingLocation()
        default: failStart("اسمح بالموقع دائمًا من إعدادات iPhone")
        }
    }
    private func failStart(_ message: String) {
        timeout?.cancel(); startCall?.reject(message); startCall = nil
        if !active { manager.stopUpdatingLocation() }
    }
    func resume() { manager.startUpdatingLocation(); manager.startMonitoringSignificantLocationChanges() }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedAlways {
            if active { resume() } else if startCall != nil { manager.startUpdatingLocation() }
        } else if manager.authorizationStatus == .authorizedWhenInUse && startCall != nil { manager.requestAlwaysAuthorization() }
        else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            prefs.set("صلاحية الموقع متوقفة؛ توجد فجوة تتبع", forKey: "attendance-error")
            failStart("اسمح بالموقع دائمًا من إعدادات iPhone")
        }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let fix = locations.last, fix.horizontalAccuracy >= 0, abs(fix.timestamp.timeIntervalSinceNow) < 30 else { return }
        if #available(iOS 15.0, *), fix.sourceInformation?.isSimulatedBySoftware == true { return }
        do {
            if let call = startCall {
                try record(type: "clock_in", location: fix)
                prefs.set(true, forKey: "attendance-active")
                timeout?.cancel(); startCall = nil; lastRecorded = Date(); resume(); call.resolve()
            } else if active && Date().timeIntervalSince(lastRecorded) >= 50 {
                try record(type: "ping", location: fix); lastRecorded = Date()
            } else { return }
            sync()
        } catch { prefs.set(error.localizedDescription, forKey: "attendance-error"); failStart(error.localizedDescription) }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        prefs.set("تعذر التقاط GPS؛ سيظهر الوقت كفجوة تتبع", forKey: "attendance-error")
    }
    func stop() throws {
        if active { try record(type: "clock_out", location: nil); prefs.set(false, forKey: "attendance-active") }
        manager.stopUpdatingLocation(); manager.stopMonitoringSignificantLocationChanges(); sync()
    }
    func logout() throws {
        guard !active && queue.isEmpty else { throw problem("أنهِ الشيفت وزامن الأحداث قبل تسجيل الخروج") }
        SecItemDelete(keyQuery as CFDictionary)
        prefs.removeObject(forKey: "attendance-user")
    }
    func status() -> [String: Any] {
        ["user": user.map { $0 as Any } ?? NSNull(), "active": active, "pending": queue.count,
         "error": queueError.isEmpty ? prefs.string(forKey: "attendance-error") ?? "" : queueError,
         "locationLabel": prefs.string(forKey: "attendance-location") ?? ""]
    }
    func sync() {
        guard !uploading else { return }
        guard !queue.isEmpty && !token().isEmpty && queueError.isEmpty else { finishBackgroundUpload(); return }
        uploading = true
        let batch = Array(queue.prefix(100))
        var request = URLRequest(url: api)
        request.httpMethod = "POST"; request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token())", forHTTPHeaderField: "Authorization")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["events": batch])
        var task = UIBackgroundTaskIdentifier.invalid
        task = UIApplication.shared.beginBackgroundTask { if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid } }
        URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                defer { if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid } }
                self.uploading = false
                guard error == nil, let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode), let data = data,
                      let result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let accepted = result["acknowledged"] as? [[String: Any]] else {
                    self.prefs.set("المزامنة مؤجلة؛ الأحداث محفوظة على الهاتف. تحقق من الاتصال والجلسة", forKey: "attendance-error"); self.finishBackgroundUpload(); return
                }
                let ids = Set(accepted.compactMap { $0["client_event_id"] as? String })
                guard !ids.isEmpty else { self.finishBackgroundUpload(); return }
                do {
                    try self.persist(self.queue.filter { !ids.contains($0["client_event_id"] as? String ?? "") })
                    self.prefs.removeObject(forKey: "attendance-error")
                    if let geo = result["location"] as? [String: Any], let name = geo["branch_name"] as? String { self.prefs.set(name, forKey: "attendance-location") }
                    if !self.queue.isEmpty { self.sync() } else { self.finishBackgroundUpload() }
                } catch { self.prefs.set(error.localizedDescription, forKey: "attendance-error"); self.finishBackgroundUpload() }
            }
        }.resume()
    }
    func registerBackgroundUpload() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: "com.joestore.attendance.upload", using: .main) { task in
            guard let processing = task as? BGProcessingTask else { task.setTaskCompleted(success: false); return }
            self.backgroundTask = processing
            processing.expirationHandler = { DispatchQueue.main.async { self.finishBackgroundUpload() } }
            self.sync()
        }
        if !queue.isEmpty { scheduleUpload() }
    }
    private func scheduleUpload() {
        let request = BGProcessingTaskRequest(identifier: "com.joestore.attendance.upload")
        request.requiresNetworkConnectivity = true
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
    private func finishBackgroundUpload() {
        backgroundTask?.setTaskCompleted(success: queue.isEmpty)
        backgroundTask = nil
        if !queue.isEmpty { scheduleUpload() }
    }
}

@objc(AttendanceTrackingPlugin)
public class AttendanceTrackingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AttendanceTrackingPlugin"
    public let jsName = "AttendanceTracking"
    public let pluginMethods: [CAPPluginMethod] = ["configure", "session", "status", "start", "stop", "sync", "logout", "openAdmin"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private var engine: AttendanceEngine { AttendanceEngine.shared }
    public override func load() { DispatchQueue.main.async { _ = self.engine } }
    @objc func configure(_ call: CAPPluginCall) { DispatchQueue.main.async { do { try self.engine.configure(token: call.getString("token") ?? "", userString: call.getString("user") ?? "{}"); call.resolve() } catch { call.reject(error.localizedDescription) } } }
    @objc func session(_ call: CAPPluginCall) { DispatchQueue.main.async { call.resolve(["token": self.engine.token()]) } }
    @objc func status(_ call: CAPPluginCall) { DispatchQueue.main.async { call.resolve(self.engine.status()) } }
    @objc func start(_ call: CAPPluginCall) { DispatchQueue.main.async { self.engine.start(call) } }
    @objc func stop(_ call: CAPPluginCall) { DispatchQueue.main.async { do { try self.engine.stop(); call.resolve() } catch { call.reject(error.localizedDescription) } } }
    @objc func sync(_ call: CAPPluginCall) { DispatchQueue.main.async { self.engine.sync(); call.resolve() } }
    @objc func logout(_ call: CAPPluginCall) { DispatchQueue.main.async { do { try self.engine.logout(); call.resolve() } catch { call.reject(error.localizedDescription) } } }
    @objc func openAdmin(_ call: CAPPluginCall) { DispatchQueue.main.async { UIApplication.shared.open(URL(string: "https://attendance-system-joe-2026.vercel.app")!); call.resolve() } }
}

class AttendanceViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(AttendanceTrackingPlugin()) }
}
