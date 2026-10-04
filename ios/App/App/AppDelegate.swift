import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Prism Mapper is a projection tool, so the screen must not dim or lock
        // while the app is on screen. The idle timer is switched back on when the
        // app stops being active, so the device sleeps normally in the background.
        // This app uses the scene lifecycle, which means UIKit does not call the
        // UIApplicationDelegate active and inactive methods. The notifications
        // below are posted either way.
        NotificationCenter.default.addObserver(self, selector: #selector(appDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appWillResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        application.isIdleTimerDisabled = true
        return true
    }

    @objc private func appDidBecomeActive() {
        UIApplication.shared.isIdleTimerDisabled = true
    }

    @objc private func appWillResignActive() {
        UIApplication.shared.isIdleTimerDisabled = false
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
