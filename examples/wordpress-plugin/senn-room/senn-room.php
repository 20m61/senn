<?php
/**
 * Plugin Name:       SENN Room Embed
 * Plugin URI:        https://github.com/20m61/senn
 * Description:       Embeds a SENN P2P room (sandboxed iframe pointing at any deployed SENN web app) via a [senn-room] shortcode. SENN is vendor-neutral; this plugin embeds the URL you supply. No data ever flows through your WordPress server.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * License:           Apache-2.0
 * License URI:       https://www.apache.org/licenses/LICENSE-2.0
 * Text Domain:       senn-room
 *
 * Spec for the embedded app: https://github.com/20m61/senn (Tier 0
 * URL fragment + Tier 1 HTTP poll signaling, all configured by the
 * web app itself — this plugin only shapes the iframe).
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * [senn-room app="https://senn.example.com/" room="" height="640" allowmedia="false"]
 *
 * Attributes:
 *   app        (required) HTTPS URL of a deployed SENN web app. Must be the
 *              same origin you trust to handle WebRTC + IndexedDB; the iframe
 *              keeps allow-same-origin so the app can use its own storage.
 *   room       (optional) URL fragment to pre-fill (e.g. "#i=…&s=…"). When
 *              present it is appended verbatim to `app` so the joiner page
 *              auto-imports the invite. Pass with care — anything you put in
 *              the fragment is visible to anyone loading the post.
 *   height     CSS height (default "640"). Numeric values become "<n>px".
 *   width      CSS width (default "100%").
 *   allowmedia "true" to add `allow="microphone; camera; display-capture"` to
 *              the iframe (off by default; not all SENN deployments need it).
 *
 * The iframe is sandboxed with the minimal attribute set SENN needs:
 *   - allow-scripts        : the SENN app is JS
 *   - allow-same-origin    : so IndexedDB (per-add-on storage) keeps working
 *   - allow-forms          : invite/answer copy-paste fields
 *   - allow-downloads      : local-vault add-on save flows
 *   - allow-popups         : QR / share modals on platforms that detach windows
 *
 * `allow-top-navigation` is intentionally NOT set, so the embedded SENN app
 * cannot navigate the WordPress page.
 */
function senn_room_shortcode($atts)
{
    $atts = shortcode_atts(
        array(
            'app'        => '',
            'room'       => '',
            'height'     => '640',
            'width'      => '100%',
            'allowmedia' => 'false',
        ),
        $atts,
        'senn-room'
    );

    $app_raw = trim((string) $atts['app']);
    if ($app_raw === '') {
        return '<p><em>' . esc_html__('senn-room: missing app="…" attribute', 'senn-room') . '</em></p>';
    }

    $app = esc_url_raw($app_raw);
    if ($app === '' || (strpos($app, 'https://') !== 0 && strpos($app, 'http://') !== 0)) {
        return '<p><em>' . esc_html__('senn-room: app must be an http(s) URL', 'senn-room') . '</em></p>';
    }

    $room = (string) $atts['room'];
    if ($room !== '' && strpos($room, '#') !== 0) {
        $room = '#' . $room;
    }

    $src = $app . $room;

    $height = preg_match('/^\d+$/', (string) $atts['height']) ? $atts['height'] . 'px' : (string) $atts['height'];
    $width  = preg_match('/^\d+$/', (string) $atts['width']) ? $atts['width'] . 'px' : (string) $atts['width'];

    $sandbox = 'allow-scripts allow-same-origin allow-forms allow-downloads allow-popups';
    $allow_attr = '';
    if (strtolower((string) $atts['allowmedia']) === 'true') {
        $allow_attr = ' allow="microphone; camera; display-capture"';
    }

    $iframe = sprintf(
        '<iframe class="senn-room-frame" src="%s" sandbox="%s" loading="lazy" referrerpolicy="no-referrer" style="width:%s;height:%s;border:0;border-radius:8px;display:block;max-width:100%%"%s></iframe>',
        esc_url($src),
        esc_attr($sandbox),
        esc_attr($width),
        esc_attr($height),
        $allow_attr
    );

    return $iframe;
}

add_shortcode('senn-room', 'senn_room_shortcode');
