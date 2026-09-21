import SwiftUI
import WebKit

/// Sandboxed rendering of `MessageDetail.bodyHtml` (WEB_INBOX.md 22.09.
/// "NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies" -- non-negotiable
/// security requirement, Massimo's own words): "HTML-Mail-Inhalt MUSS in
/// einer Sandbox angezeigt werden -- iOS: WKWebView mit deaktiviertem
/// JavaScript und eingeschraenkter Navigation. Kein direktes Einbetten von
/// Absender-HTML in den normalen DOM/normale View-Hierarchie."
///
/// Two guarantees this view provides on top of what the backend already
/// sanitizes (`backend/README.md` "HTML-Rendering des Mail-Bodies" --
/// `<script>`/`<style>`/`<iframe>`/`<form>`/event-handlers already stripped
/// server-side, links already rewritten to `${API_BASE}/link-check?url=...`):
/// 1. JavaScript is disabled on the `WKWebViewConfiguration` itself (defense
///    in depth -- even if a sanitizer bug ever let a script tag through, it
///    could not execute here).
/// 2. Navigation is restricted to the single initial `loadHTMLString` call --
///    any subsequent navigation (a tapped link) is cancelled and handed to
///    the system browser via `UIApplication.shared.open(url)` instead of
///    letting the WKWebView itself navigate there.
///
/// Deliberately out of scope (see `ios/README.md` Nachtrag for this
/// feature): per-mail "Bilder trotzdem laden" -- the backend already strips
/// blocked `<img src>` before this view ever sees the HTML, there is
/// currently no endpoint to re-fetch an unblocked version.
struct MailBodyWebView: UIViewRepresentable {
    let html: String
    /// Bound back to the SwiftUI caller so the surrounding `ScrollView` can
    /// size this view to its actual rendered content instead of an
    /// arbitrary fixed height (see `Coordinator.webView(_:didFinish:)`).
    @Binding var height: CGFloat

    func makeCoordinator() -> Coordinator {
        Coordinator(height: $height)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webpagePreferences = WKWebpagePreferences()
        // Deployment target is iOS 17 (project.pbxproj
        // IPHONEOS_DEPLOYMENT_TARGET = 17.0) -- the modern
        // `allowsContentJavaScript` API (iOS 15+) is available, no need for
        // the older `WKPreferences.javaScriptEnabled` fallback.
        webpagePreferences.allowsContentJavaScript = false

        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences = webpagePreferences

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        // Pragmatic auto-sizing fallback (see file-level doc comment on
        // `Coordinator`): height is measured after load and the frame is
        // capped, but internal scrolling stays enabled in case the
        // measurement undershoots the real content height.
        webView.scrollView.isScrollEnabled = true
        webView.scrollView.bounces = false
        // `loadHTMLString` with `baseURL: nil` -- never `load(URLRequest)`/
        // `loadFileURL` with a remote URL for sender-controlled HTML itself.
        webView.loadHTMLString(Self.wrapped(html), baseURL: nil)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // `html` never changes for an already-loaded message -- SwiftUI
        // creates a fresh `MailBodyWebView` (and coordinator) per message
        // via the enclosing view's identity, so no reload/diffing needed
        // here.
    }

    /// Minimal wrapper: system font + viewport meta so text reflows to the
    /// device width instead of forcing horizontal scroll, `max-width: 100%`
    /// on images (the backend already strips remote `<img src>` per
    /// `blockRemoteImages`, but a same-content `data:`/inline image could
    /// still overflow otherwise). `color-scheme: light dark` so the
    /// WKWebView's default background follows system dark mode.
    private static func wrapped(_ bodyHtml: String) -> String {
        """
        <!DOCTYPE html>
        <html>
        <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
        :root { color-scheme: light dark; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 16px;
            line-height: 1.4;
            margin: 0;
            padding: 0;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        img { max-width: 100%; height: auto; }
        </style>
        </head>
        <body>\(bodyHtml)</body>
        </html>
        """
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        @Binding private var height: CGFloat
        /// Flips to `true` after the initial `loadHTMLString` load finishes.
        /// Every `decidePolicyFor` call before that belongs to that same
        /// initial load (allowed); every call after it is a real navigation
        /// attempt -- i.e. a tapped link -- and gets intercepted.
        private var didFinishInitialLoad = false

        init(height: Binding<CGFloat>) {
            self._height = height
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard didFinishInitialLoad else {
                decisionHandler(.allow)
                return
            }
            // Restricted navigation: the WKWebView itself never navigates
            // away from the originally loaded HTML. Links already point at
            // `${API_BASE}/link-check?url=...` (backend rewrite, see
            // `MessageDetail.bodyHtml` comment) -- open that click-time
            // check URL in the system browser instead.
            if let url = navigationAction.request.url {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            didFinishInitialLoad = true
            // JavaScript is disabled, so `evaluateJavaScript`-based height
            // measurement isn't available -- but WKWebView still performs
            // native HTML/CSS layout with JS off, so
            // `scrollView.contentSize` already reflects the real rendered
            // height at this point. Clamped to a sane range; the webview's
            // own internal scrolling (`isScrollEnabled = true`, set in
            // `makeUIView`) covers content taller than the cap.
            let measured = webView.scrollView.contentSize.height
            let clamped = min(max(measured, 120), 600)
            DispatchQueue.main.async {
                self.height = clamped
            }
        }
    }
}
