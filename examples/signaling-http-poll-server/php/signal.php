<?php
/**
 * SENN Tier-1 signaling endpoint — PHP reference.
 *
 * Wire contract: docs/signaling-http-poll-spec.md.
 *
 * Storage: ./data/<roomId>.json (JSON array of {id, ts, message}).
 * TTL: 60 seconds, enforced lazily on every read/write.
 *
 * Deployment:
 *   - Drop into your hosting's public dir.
 *   - Ensure `data/` exists and is writable by the PHP user.
 *   - The HttpPollSignaling adapter calls
 *       POST <endpoint>/<roomId>
 *       GET  <endpoint>/<roomId>?since=<cursor>
 *     where <endpoint> is e.g. https://your-host/signal.php?room=
 *     so the room id arrives as a query parameter, OR as PATH_INFO if
 *     your host rewrites /signal.php/<roomId> to /signal.php.
 */

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: content-type");
header("Cache-Control: no-store");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
    http_response_code(204);
    exit;
}

$ROOM_ID_RE = '/^[0-9a-hjkmnp-tv-z]{26}$/';
$KNOWN_KINDS = ["offer", "answer", "ice", "bye"];
$TTL_SECONDS = 60;

$roomId = $_GET["room"] ?? trim($_SERVER["PATH_INFO"] ?? "", "/");
if (!preg_match($ROOM_ID_RE, (string) $roomId)) {
    http_response_code(400); echo "bad room id"; exit;
}

$dataDir = __DIR__ . "/data";
if (!is_dir($dataDir) && !mkdir($dataDir, 0700, true) && !is_dir($dataDir)) {
    http_response_code(500); echo "data dir"; exit;
}
$file = $dataDir . "/" . $roomId . ".json";

function load_queue(string $file, int $ttl): array {
    if (!is_file($file)) return [];
    $raw = @file_get_contents($file);
    if ($raw === false) return [];
    $items = json_decode($raw, true);
    if (!is_array($items)) return [];
    $cutoff = time() - $ttl;
    $alive = array_values(array_filter($items, fn($it) => isset($it["ts"]) && $it["ts"] >= $cutoff));
    return $alive;
}

function save_queue(string $file, array $items): void {
    $tmp = $file . ".tmp";
    file_put_contents($tmp, json_encode($items), LOCK_EX);
    rename($tmp, $file);
}

header("Content-Type: application/json");

if ($_SERVER["REQUEST_METHOD"] === "POST") {
    $raw = file_get_contents("php://input");
    $body = json_decode($raw, true);
    if (!is_array($body) || !isset($body["message"]) || !is_array($body["message"])) {
        http_response_code(400); echo json_encode(["error" => "missing message"]); exit;
    }
    $kind = $body["message"]["kind"] ?? null;
    if (!in_array($kind, $KNOWN_KINDS, true)) {
        http_response_code(400); echo json_encode(["error" => "unknown kind"]); exit;
    }
    $items = load_queue($file, $TTL_SECONDS);
    $id = sprintf("m_%013d_%04d", round(microtime(true) * 1000), random_int(0, 9999));
    $items[] = ["id" => $id, "ts" => time(), "message" => $body["message"]];
    save_queue($file, $items);
    echo json_encode(["id" => $id, "cursor" => $id]);
    exit;
}

if ($_SERVER["REQUEST_METHOD"] === "GET") {
    $since = (string) ($_GET["since"] ?? "");
    $items = load_queue($file, $TTL_SECONDS);
    if ($since !== "") {
        $idx = -1;
        foreach ($items as $i => $it) {
            if (($it["id"] ?? "") === $since) { $idx = $i; break; }
        }
        if ($idx >= 0) $items = array_slice($items, $idx + 1);
    }
    save_queue($file, $items); // also persist the TTL-pruned list
    $cursor = empty($items) ? $since : end($items)["id"];
    $out = array_map(fn($it) => ["id" => $it["id"], "message" => $it["message"]], $items);
    echo json_encode(["messages" => $out, "cursor" => $cursor]);
    exit;
}

http_response_code(405);
echo json_encode(["error" => "method not allowed"]);
