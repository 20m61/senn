=== SENN Room Embed ===
Contributors: senn-project
Tags: webrtc, p2p, signaling, privacy
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.1.0
License: Apache-2.0
License URI: https://www.apache.org/licenses/LICENSE-2.0

Embed a SENN P2P room (vendor-neutral, browser-native) inside any WordPress post via a [senn-room] shortcode.

== Description ==

SENN is an open-source browser-native P2P runtime: peers talk directly over WebRTC, the host site only delivers static files. This plugin adds a single shortcode that drops a deployed SENN web app into a WordPress page as a sandboxed iframe.

The plugin does **not** ship a SENN app of its own — you point it at any URL you trust (your own deployment, a community-run instance, a one-off demo). No data ever flows through the WordPress server; the iframe talks WebRTC straight to the other peer.

== Installation ==

1. Upload `senn-room/` to your `/wp-content/plugins/` directory, or install via the standard WP plugin installer.
2. Activate "SENN Room Embed".
3. Drop a `[senn-room app="https://your-senn.example/"]` shortcode into any post.

== Frequently Asked Questions ==

= Does this plugin store any user data? =

No. It outputs a static `<iframe>` tag. All P2P traffic happens between the visitor's browser and their peer; the WordPress server is not involved.

= Why is the iframe sandboxed? =

To keep the embedded SENN app from navigating the surrounding WordPress page. The sandbox flags the plugin uses (`allow-scripts allow-same-origin allow-forms allow-downloads allow-popups`) are the minimum SENN needs to run with IndexedDB-backed storage and local-vault downloads.

= Can I let the embedded app use my microphone/camera? =

Pass `allowmedia="true"` to the shortcode. This adds `allow="microphone; camera; display-capture"` to the iframe. Off by default because most SENN deployments today are text/file workflows.

= Where do I find an `app=` URL? =

Either run your own (the SENN repo includes Tier 0 / Tier 1 reference deployments at `docs/deployment.md`) or point at a community instance. SENN does not operate a default hosted app.

== Changelog ==

= 0.1.0 =
* Initial scaffold. Single `[senn-room]` shortcode.
