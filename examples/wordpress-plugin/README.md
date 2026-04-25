# SENN WordPress plugin scaffold

A minimal, vendor-neutral plugin that embeds a deployed SENN web app
into a WordPress post via a single `[senn-room]` shortcode. About
~80 lines of PHP. No bundled SENN app; you point it at any URL you
trust.

| File | Purpose |
|------|---------|
| [`senn-room/senn-room.php`](senn-room/senn-room.php) | Shortcode handler + iframe markup. |
| [`senn-room/readme.txt`](senn-room/readme.txt) | WordPress.org-style plugin readme. |

## Install

```
cp -r examples/wordpress-plugin/senn-room  /path/to/wp-content/plugins/
```

…or zip the `senn-room` directory and upload via the WP plugin
installer. Activate "SENN Room Embed" in *Plugins → Installed*.

## Usage

```
[senn-room app="https://senn.example.com/"]
[senn-room app="https://senn.example.com/" room="#i=…&s=…"]
[senn-room app="https://senn.example.com/" height="480" allowmedia="true"]
```

| Attribute | Default | Description |
|-----------|---------|-------------|
| `app`        | (required) | HTTPS URL of a deployed SENN web app. |
| `room`       | (none)     | Pre-filled URL fragment, e.g. an invite. Appended verbatim. |
| `width`      | `100%`     | CSS width. Bare numbers become `<n>px`. |
| `height`     | `640`      | CSS height. Bare numbers become `<n>px`. |
| `allowmedia` | `false`    | When `true`, adds `allow="microphone; camera; display-capture"`. |

## Why this stays a scaffold

SENN does not embed a vendor or a default app
([ADR-0007](../../docs/adr/0007-vendor-neutral-signaling-and-relay.md)).
The plugin therefore intentionally:

- ships no JS, no admin page, no settings,
- never touches the database,
- never proxies P2P data through the server,
- accepts arbitrary `app=` URLs and refuses to assume a default.

Operators who want a turnkey "self-hosted SENN room embedded in a
WordPress page" build it as: a single static deployment of
`apps/web` (per [docs/deployment.md](../../docs/deployment.md))
plus this plugin pointing at it.

## Security notes

The iframe is sandboxed with the minimum needed for SENN to run:

- `allow-scripts` — the SENN app is JS.
- `allow-same-origin` — IndexedDB-backed per-add-on storage needs the
  app's real origin, not the sandbox's opaque one.
- `allow-forms` — invite/answer paste fields.
- `allow-downloads` — local-vault add-on save flow.
- `allow-popups` — share Modal flows.

`allow-top-navigation` is **not** set, so the embedded SENN app
cannot navigate the surrounding WordPress page.

The CSP of the SENN app itself is unaffected by this plugin. If you
add a custom `Content-Security-Policy` header on the WordPress site,
remember to allow the SENN app origin in `frame-src`.
