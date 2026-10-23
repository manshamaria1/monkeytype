<?php
/**
 * Multiplayer races for ordinary WordPress hosting (no WebSockets). Browsers poll the
 * room about twice a second. The server is the source of truth: it picks the text,
 * sets the start time, re-runs every player's keystrokes through TT_Engine, and decides
 * finish order and outcomes, exactly like the Node version (server/multiplayer.ts).
 */
defined('ABSPATH') || exit;

const TT_MP_COUNTDOWN_MS = 3000;
const TT_MP_MAX_RACE_MS = 180000;
const TT_MP_CONNECTED_MS = 8000;      // seen within this window = connected
const TT_MP_GRACE_MS = 30000;         // time to come back before being dropped / marked not finished
const TT_MP_EMPTY_ROOM_MS = 600000;   // rooms nobody has polled for 10 minutes are deleted
const TT_MP_MAX_PLAYERS = 8;
const TT_MP_AHEAD_MS = 1500;
const TT_MP_BEHIND_MS = 3000;
const TT_MP_MAX_WPM = 350;
const TT_MP_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

add_action('rest_api_init', function () {
    foreach (['create', 'join', 'action', 'events', 'state'] as $op) {
        register_rest_route(TT_NS, "/mp/$op", [
            'methods' => 'POST', // POST so the seat token never appears in URLs or server logs
            'callback' => "tt_mp_rest_$op",
            'permission_callback' => '__return_true',
        ]);
    }
});

/** Serialise all requests for one room with a MySQL named lock. */
function tt_mp_locked(string $code, callable $fn) {
    global $wpdb;
    $lock = 'tt_room_' . $code;
    if (!$wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 5)', $lock))) return tt_error('The room is busy, please try again.', 503);
    try {
        return $fn();
    } finally {
        $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock));
    }
}

function tt_mp_room(string $code): ?array {
    global $wpdb;
    $room = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . tt_table('rooms') . ' WHERE code = %s', $code), ARRAY_A);
    if (!$room) return null;
    $room['settings'] = json_decode($room['settings'], true);
    $room['words'] = json_decode($room['words'], true) ?: [];
    $room['players'] = $wpdb->get_results($wpdb->prepare('SELECT * FROM ' . tt_table('room_players') . ' WHERE room_id = %d ORDER BY seat', $room['id']), ARRAY_A);
    return $room;
}

function tt_mp_save_room(array $room): void {
    global $wpdb;
    $wpdb->update(tt_table('rooms'), [
        'state' => $room['state'],
        'host_seat' => $room['host_seat'],
        'settings' => wp_json_encode($room['settings']),
        'words' => wp_json_encode($room['words']),
        'start_at' => $room['start_at'],
        'ended_at' => $room['ended_at'],
        'end_reason' => $room['end_reason'],
        'next_seat' => $room['next_seat'],
        'updated_at' => tt_now_ms(),
    ], ['id' => $room['id']]);
}

function tt_mp_save_player(array $room, array $p): void {
    global $wpdb;
    $cols = ['ready', 'events', 'progress', 'wpm', 'accuracy', 'finish_ms', 'dnf_reason', 'place', 'outcome', 'last_seen', 'name'];
    $wpdb->update(tt_table('room_players'), array_intersect_key($p, array_flip($cols)), ['room_id' => $room['id'], 'seat' => $p['seat']]);
}

function tt_mp_connected(array $p, int $now): bool {
    return $now - (int) $p['last_seen'] < TT_MP_CONNECTED_MS;
}

function tt_mp_find(array $room, string $token): ?int {
    foreach ($room['players'] as $i => $p) if (hash_equals($p['token'], $token)) return $i;
    return null;
}

function tt_mp_settings($s) {
    if (!is_array($s)) return tt_error('settings: Invalid');
    $lang = $s['language'] ?? '';
    $count = $s['wordCount'] ?? 0;
    if (!is_string($lang) || !tt_is_language($lang)) return tt_error('Unknown language');
    if (!is_int($count) || $count < 10 || $count > 100) return tt_error('wordCount: Must be 10–100');
    return ['language' => $lang, 'wordCount' => $count];
}

/** Display name: the WordPress name, or "<name> (guest)" for visitors. */
function tt_mp_name($requested): ?string {
    $u = wp_get_current_user();
    if ($u->exists()) return mb_substr($u->display_name ?: $u->user_nicename, 0, 40);
    $n = is_string($requested) ? trim($requested) : '';
    if ($n === '' || mb_strlen($n) > 20 || !preg_match('/^[\p{L}\p{N}_ .-]+$/u', $n)) return null;
    return $n . ' (guest)';
}

function tt_mp_words(string $language, int $count): array {
    $pool = array_slice(tt_data()['languages'][$language]['words'], 0, 200);
    $out = [];
    $recent = [];
    while (count($out) < $count) {
        $w = $pool[random_int(0, count($pool) - 1)];
        if (in_array($w, $recent, true) && count($pool) > 6) continue;
        $out[] = $w;
        $recent[] = $w;
        if (count($recent) > 5) array_shift($recent);
    }
    return $out;
}

function tt_mp_add_player(array &$room, string $name): array {
    global $wpdb;
    $uid = get_current_user_id();
    $p = [
        'room_id' => $room['id'],
        'seat' => (int) $room['next_seat'],
        'user_id' => $uid ?: null,
        'name' => $name,
        'avatar' => $uid ? tt_avatar_of($uid) : 'monkey',
        'token' => bin2hex(random_bytes(16)),
        'last_seen' => tt_now_ms(),
        'ready' => 0,
        'events' => '[]',
        'progress' => 0,
        'wpm' => 0,
        'accuracy' => 0,
        'finish_ms' => null,
        'dnf_reason' => null,
        'place' => null,
        'outcome' => null,
    ];
    $wpdb->insert(tt_table('room_players'), $p);
    $room['next_seat']++;
    $room['players'][] = $p;
    if (count($room['players']) === 1) $room['host_seat'] = $p['seat'];
    return $p;
}

/** Advance time-based state: countdown -> racing, race end, dropped players, host handover. */
function tt_mp_tick(array &$room): void {
    global $wpdb;
    $now = tt_now_ms();
    if ($room['state'] === 'countdown' && $now >= (int) $room['start_at']) $room['state'] = 'racing';
    if ($room['state'] === 'racing' || $room['state'] === 'countdown') {
        $all_done = true;
        foreach ($room['players'] as $p) {
            $done = $p['finish_ms'] !== null || $p['dnf_reason'] !== null || $now - (int) $p['last_seen'] >= TT_MP_GRACE_MS;
            if (!$done) $all_done = false;
        }
        if ($all_done) tt_mp_end_race($room, 'all-finished');
        elseif ($now >= (int) $room['start_at'] + TT_MP_MAX_RACE_MS) tt_mp_end_race($room, 'timeout');
    }
    if ($room['state'] === 'lobby' || $room['state'] === 'finished') {
        foreach ($room['players'] as $i => $p) {
            if ($now - (int) $p['last_seen'] >= TT_MP_GRACE_MS) {
                $wpdb->delete(tt_table('room_players'), ['room_id' => $room['id'], 'seat' => $p['seat']]);
                unset($room['players'][$i]);
            }
        }
        $room['players'] = array_values($room['players']);
    }
    // Hand the host role to a connected player if the host is gone.
    $host = null;
    foreach ($room['players'] as $p) if ((int) $p['seat'] === (int) $room['host_seat']) $host = $p;
    if (!$host || !tt_mp_connected($host, $now)) {
        foreach ($room['players'] as $p) {
            if (tt_mp_connected($p, $now)) { $room['host_seat'] = (int) $p['seat']; break; }
        }
    }
}

/** Places: finishers by time (ties share a place), then the rest by progress. */
function tt_mp_outcomes(array $entries): array {
    $finished = array_values(array_filter($entries, fn($e) => $e['finishMs'] !== null));
    $unfinished = array_values(array_filter($entries, fn($e) => $e['finishMs'] === null));
    usort($finished, fn($a, $b) => $a['finishMs'] <=> $b['finishMs']);
    usort($unfinished, fn($a, $b) => ($b['progress'] <=> $a['progress']) ?: ($b['wpm'] <=> $a['wpm']));
    $out = [];
    $place = 0;
    foreach ($finished as $i => $e) {
        if ($i === 0 || $e['finishMs'] !== $finished[$i - 1]['finishMs']) $place = $i + 1;
        $out[] = $e + ['place' => $place, 'outcome' => 'loss'];
    }
    $first = count(array_filter($out, fn($e) => $e['place'] === 1));
    foreach ($out as &$e) if ($e['place'] === 1) $e['outcome'] = $first > 1 ? 'draw' : 'win';
    unset($e);
    foreach ($unfinished as $i => $e) $out[] = $e + ['place' => count($finished) + $i + 1, 'outcome' => 'dnf'];
    return $out;
}

function tt_mp_end_race(array &$room, string $reason): void {
    global $wpdb;
    $now = tt_now_ms();
    $elapsed = $now - (int) $room['start_at'];
    $entries = [];
    foreach ($room['players'] as $i => $p) {
        if ($p['finish_ms'] === null && $p['dnf_reason'] === null) {
            // Final speed of unfinished players at the end of the race.
            $e = tt_replay($room['words'], json_decode($p['events'], true) ?: [], ['bounded' => true]);
            $e->finish(max($elapsed, $e->last_t));
            $s = $e->stats();
            $room['players'][$i]['wpm'] = $s['wpm'];
            $room['players'][$i]['accuracy'] = $s['accuracy'];
        }
        $entries[] = ['i' => $i, 'finishMs' => $p['dnf_reason'] ? null : ($p['finish_ms'] === null ? null : (int) $p['finish_ms']), 'progress' => (float) $room['players'][$i]['progress'], 'wpm' => (float) $room['players'][$i]['wpm']];
    }
    foreach (tt_mp_outcomes($entries) as $o) {
        $room['players'][$o['i']]['place'] = $o['place'];
        $room['players'][$o['i']]['outcome'] = $o['outcome'];
    }
    $room['state'] = 'finished';
    $room['ended_at'] = $now;
    $room['end_reason'] = $reason;
    foreach ($room['players'] as $p) tt_mp_save_player($room, $p);
    tt_mp_save_room($room);

    // Race history.
    $wpdb->insert(tt_table('matches'), [
        'room_code' => $room['code'],
        'language' => $room['settings']['language'],
        'words' => wp_json_encode($room['words']),
        'started_at' => gmdate('Y-m-d H:i:s', (int) floor($room['start_at'] / 1000)),
        'ended_at' => gmdate('Y-m-d H:i:s', (int) floor($now / 1000)),
        'end_reason' => $reason,
    ]);
    $match_id = (int) $wpdb->insert_id;
    foreach ($room['players'] as $p) {
        $wpdb->insert(tt_table('match_players'), [
            'match_id' => $match_id,
            'seat' => $p['seat'],
            'user_id' => $p['user_id'] ?: null,
            'guest_name' => $p['user_id'] ? null : $p['name'],
            'place' => $p['place'],
            'outcome' => $p['outcome'],
            'finished' => $p['finish_ms'] !== null && !$p['dnf_reason'] ? 1 : 0,
            'finish_ms' => $p['finish_ms'],
            'wpm' => $p['wpm'],
            'accuracy' => $p['accuracy'],
            'progress' => $p['progress'],
        ]);
    }
    foreach ($room['players'] as $p) if ($p['user_id']) tt_update_achievements((int) $p['user_id']);
}

function tt_mp_view(array $room, int $you, bool $with_events = false): array {
    $now = tt_now_ms();
    $players = array_map(fn($p) => [
        'seat' => (int) $p['seat'],
        'name' => $p['name'],
        'avatar' => tt_avatar_emoji($p['avatar']),
        'registered' => (bool) $p['user_id'],
        'connected' => tt_mp_connected($p, $now),
        'ready' => (bool) (int) $p['ready'],
        'host' => (int) $p['seat'] === (int) $room['host_seat'],
        'progress' => (float) $p['progress'],
        'wpm' => (float) $p['wpm'],
        'accuracy' => (float) $p['accuracy'],
        'finishMs' => $p['finish_ms'] === null ? null : (int) $p['finish_ms'],
        'dnfReason' => $p['dnf_reason'],
        'place' => $p['place'] === null ? null : (int) $p['place'],
        'outcome' => $p['outcome'],
    ], $room['players']);
    $out = [
        'code' => $room['code'],
        'state' => $room['state'],
        'settings' => $room['settings'],
        'words' => $room['state'] === 'lobby' ? [] : $room['words'],
        'startAt' => $room['start_at'] === null ? null : (int) $room['start_at'],
        'endReason' => $room['end_reason'],
        'maxRaceMs' => TT_MP_MAX_RACE_MS,
        'players' => $players,
        'you' => $you,
        'serverNow' => $now,
    ];
    if ($with_events) {
        foreach ($room['players'] as $p) if ((int) $p['seat'] === $you) $out['yourEvents'] = json_decode($p['events'], true) ?: [];
    }
    return $out;
}

function tt_mp_param(WP_REST_Request $r, string $k): string {
    $v = tt_body($r)[$k] ?? $r->get_param($k);
    return is_string($v) ? $v : '';
}

// ---------------------------------------------------------------- endpoints

function tt_mp_rest_create(WP_REST_Request $r) {
    global $wpdb;
    if ($e = tt_rate_limit('mp-create', 20, 600)) return $e;
    $b = tt_body($r);
    $settings = tt_mp_settings($b['settings'] ?? null);
    if (is_wp_error($settings)) return $settings;
    $name = tt_mp_name($b['name'] ?? '');
    if (!$name) return tt_error('Enter a name (letters and numbers, up to 20 characters)');
    for ($try = 0; $try < 20; $try++) {
        $code = '';
        for ($i = 0; $i < 5; $i++) $code .= TT_MP_CODE_CHARS[random_int(0, strlen(TT_MP_CODE_CHARS) - 1)];
        $ok = $wpdb->insert(tt_table('rooms'), ['code' => $code, 'state' => 'lobby', 'host_seat' => 0, 'settings' => wp_json_encode($settings), 'words' => '[]', 'next_seat' => 0, 'updated_at' => tt_now_ms()]);
        if ($ok) break;
    }
    if (empty($ok)) return tt_error('Could not create a room. Please try again.', 500);
    return tt_mp_locked($code, function () use ($code, $name) {
        $room = tt_mp_room($code);
        $p = tt_mp_add_player($room, $name);
        tt_mp_save_room($room);
        return ['code' => $code, 'seat' => $p['seat'], 'token' => $p['token'], 'state' => tt_mp_view($room, $p['seat'])];
    });
}

function tt_mp_rest_join(WP_REST_Request $r) {
    if ($e = tt_rate_limit('mp-join', 60, 600)) return $e;
    $code = strtoupper(tt_mp_param($r, 'code'));
    if (!preg_match('/^[A-Z2-9]{5}$/', $code)) return tt_error('Room not found. Check the code and try again.', 404);
    $token = tt_mp_param($r, 'token');
    $name = tt_body($r)['name'] ?? '';
    return tt_mp_locked($code, function () use ($code, $token, $name) {
        $room = tt_mp_room($code);
        if (!$room) return tt_error('Room not found. Check the code and try again.', 404);
        tt_mp_tick($room);
        $i = $token ? tt_mp_find($room, $token) : null;
        if ($i !== null) {
            // Rejoin the same seat (page reload or network drop).
            $room['players'][$i]['last_seen'] = tt_now_ms();
            tt_mp_save_player($room, $room['players'][$i]);
            tt_mp_save_room($room);
            $seat = (int) $room['players'][$i]['seat'];
            return ['code' => $code, 'seat' => $seat, 'token' => $token, 'resumed' => true, 'state' => tt_mp_view($room, $seat, true)];
        }
        if ($room['state'] !== 'lobby' && $room['state'] !== 'finished') return tt_error('This race has already started. Wait for it to finish.', 409);
        if (count($room['players']) >= TT_MP_MAX_PLAYERS) return tt_error('This room is full.', 409);
        $uid = get_current_user_id();
        if ($uid) foreach ($room['players'] as $p) if ((int) $p['user_id'] === $uid) return tt_error('You are already in this room in another tab.', 409);
        $display = tt_mp_name($name);
        if (!$display) return tt_error('Enter a name (letters and numbers, up to 20 characters)');
        $p = tt_mp_add_player($room, $display);
        tt_mp_save_room($room);
        return ['code' => $code, 'seat' => $p['seat'], 'token' => $p['token'], 'state' => tt_mp_view($room, $p['seat'])];
    });
}

/** Common wrapper: lock the room, find the caller's seat, mark them as seen. */
function tt_mp_with_player(WP_REST_Request $r, callable $fn) {
    $code = strtoupper(tt_mp_param($r, 'code'));
    $token = tt_mp_param($r, 'token');
    if (!preg_match('/^[A-Z2-9]{5}$/', $code) || !preg_match('/^[a-f0-9]{32}$/', $token)) return tt_error('Room not found.', 404);
    return tt_mp_locked($code, function () use ($code, $token, $fn) {
        $room = tt_mp_room($code);
        if (!$room) return tt_error('This room no longer exists.', 404);
        $i = tt_mp_find($room, $token);
        if ($i === null) return tt_error('You are not in this room.', 403);
        $room['players'][$i]['last_seen'] = tt_now_ms();
        tt_mp_tick($room);
        $i = tt_mp_find($room, $token);
        if ($i === null) return tt_error('You are not in this room.', 403);
        $res = $fn($room, $i);
        if (is_wp_error($res)) return $res;
        $extra = is_array($res) ? $res : [];
        // The player list may have changed (start drops absent players, leave removes the caller).
        $j = tt_mp_find($room, $token);
        if ($j !== null) tt_mp_save_player($room, $room['players'][$j]);
        tt_mp_save_room($room);
        return ['state' => tt_mp_view($room, $j !== null ? (int) $room['players'][$j]['seat'] : -1)] + $extra;
    });
}

function tt_mp_rest_state(WP_REST_Request $r) {
    return tt_mp_with_player($r, fn() => null);
}

function tt_mp_rest_action(WP_REST_Request $r) {
    $b = tt_body($r);
    $action = $b['action'] ?? '';
    return tt_mp_with_player($r, function (array &$room, int $i) use ($b, $action) {
        global $wpdb;
        $me = &$room['players'][$i];
        $is_host = (int) $me['seat'] === (int) $room['host_seat'];
        $now = tt_now_ms();
        switch ($action) {
            case 'ready':
                if ($room['state'] !== 'lobby') return null;
                $me['ready'] = !empty($b['ready']) ? 1 : 0;
                return null;
            case 'settings':
                if (!$is_host) return tt_error('Only the host can change settings', 403);
                if ($room['state'] !== 'lobby' && $room['state'] !== 'finished') return tt_error('Settings are locked during a race', 409);
                $s = tt_mp_settings($b['settings'] ?? null);
                if (is_wp_error($s)) return $s;
                $room['settings'] = $s;
                foreach ($room['players'] as &$p) { $p['ready'] = 0; tt_mp_save_player($room, $p); }
                unset($p);
                return null;
            case 'start':
                if (!$is_host) return tt_error('Only the host can start the race', 403);
                if ($room['state'] !== 'lobby') return tt_error('The race has already started', 409);
                $active = array_values(array_filter($room['players'], fn($p) => tt_mp_connected($p, $now)));
                if (count($active) < 2) return tt_error('At least two players are needed to start a race', 409);
                $waiting = array_filter($active, fn($p) => !(int) $p['ready'] && (int) $p['seat'] !== (int) $room['host_seat']);
                if ($waiting) return tt_error('Waiting for ' . implode(', ', array_column($waiting, 'name')) . ' to be ready', 409);
                // Players not connected at the start do not take part.
                foreach ($room['players'] as $p) {
                    if (!tt_mp_connected($p, $now)) $wpdb->delete(tt_table('room_players'), ['room_id' => $room['id'], 'seat' => $p['seat']]);
                }
                $room['words'] = tt_mp_words($room['settings']['language'], $room['settings']['wordCount']);
                $room['start_at'] = $now + TT_MP_COUNTDOWN_MS;
                $room['state'] = 'countdown';
                $room['ended_at'] = null;
                $room['end_reason'] = null;
                $kept = [];
                foreach ($room['players'] as $p) {
                    if (!tt_mp_connected($p, $now)) continue;
                    $p = array_merge($p, ['events' => '[]', 'progress' => 0, 'wpm' => 0, 'accuracy' => 0, 'finish_ms' => null, 'dnf_reason' => null, 'place' => null, 'outcome' => null]);
                    tt_mp_save_player($room, $p);
                    $kept[] = $p;
                }
                $room['players'] = $kept;
                return null;
            case 'rematch':
                if (!$is_host) return tt_error('Only the host can start a rematch', 403);
                if ($room['state'] !== 'finished') return null;
                $room['state'] = 'lobby';
                $room['words'] = [];
                $room['start_at'] = $room['ended_at'] = $room['end_reason'] = null;
                foreach ($room['players'] as &$p) {
                    $p = array_merge($p, ['ready' => 0, 'events' => '[]', 'progress' => 0, 'wpm' => 0, 'accuracy' => 0, 'finish_ms' => null, 'dnf_reason' => null, 'place' => null, 'outcome' => null]);
                    tt_mp_save_player($room, $p);
                }
                unset($p);
                return null;
            case 'leave':
                if ($room['state'] === 'racing' || $room['state'] === 'countdown') {
                    if ($me['finish_ms'] === null) $me['dnf_reason'] = 'left';
                    $me['last_seen'] = $now - TT_MP_GRACE_MS;
                } else {
                    $wpdb->delete(tt_table('room_players'), ['room_id' => $room['id'], 'seat' => $me['seat']]);
                    unset($room['players'][$i]);
                    $room['players'] = array_values($room['players']);
                }
                tt_mp_tick($room);
                return null;
        }
        return tt_error('Unknown action');
    });
}

function tt_mp_rest_events(WP_REST_Request $r) {
    $events = tt_body($r)['events'] ?? null;
    // "from" = position of the first event in the player's full log. Retried batches overlap
    // what the server already has; the overlap is skipped so nothing is applied twice.
    $from = tt_body($r)['from'] ?? null;
    if (!is_int($from) || $from < 0) return tt_error('from: Invalid');
    if (!is_array($events) || count($events) > 500) return tt_error('events: Invalid');
    foreach ($events as $ev) {
        $k = $ev['k'] ?? null;
        $t = $ev['t'] ?? null;
        if (!(is_int($t) || is_float($t)) || $t < 0 || $t > 3700000 || !in_array($k, ['i', 'c', 'b'], true)) return tt_error('events: Invalid event');
        if ($k === 'i' && (!isset($ev['v']) || !is_string($ev['v']) || mb_strlen($ev['v']) > 120)) return tt_error('events: Invalid event');
    }
    return tt_mp_with_player($r, function (array &$room, int $i) use ($events, $from) {
        $me = &$room['players'][$i];
        $log = json_decode($me['events'], true) ?: [];
        if (($room['state'] !== 'racing' && $room['state'] !== 'countdown') || $me['finish_ms'] !== null || $me['dnf_reason'] !== null) {
            return ['accepted' => $from + count($events)]; // nothing more is needed from this player
        }
        $skip = count($log) - $from;
        if ($skip < 0) return ['accepted' => count($log)]; // a batch went missing: client resends from here
        $events = array_slice($events, $skip);
        $elapsed = tt_now_ms() - (int) $room['start_at'];
        foreach ($events as $ev) {
            if ($ev['t'] > $elapsed + TT_MP_AHEAD_MS) {
                $me['dnf_reason'] = 'clock';
                break;
            }
            // A batch that arrives late cannot claim keystrokes earlier than the server allows.
            $ev['t'] = max($ev['t'], $elapsed - TT_MP_BEHIND_MS);
            $clean = ['t' => $ev['t'], 'k' => $ev['k']];
            if ($ev['k'] === 'i') $clean['v'] = $ev['v'];
            $log[] = $clean;
        }
        $engine = tt_replay($room['words'], $log, ['bounded' => true]);
        $s = $engine->stats();
        $me['events'] = wp_json_encode($log);
        $me['progress'] = $engine->progress();
        $me['wpm'] = $s['wpm'];
        $me['accuracy'] = $s['accuracy'];
        if ($engine->finished && !$me['dnf_reason']) {
            if ($s['wpm'] > TT_MP_MAX_WPM) $me['dnf_reason'] = 'implausible';
            elseif ($engine->failed) $me['dnf_reason'] = 'failed';
            else $me['finish_ms'] = (int) round($engine->end_t ?? $elapsed);
        }
        tt_mp_tick($room);
        return ['accepted' => count($log)];
    });
}

/** Hourly: remove rooms nobody has used for a while. */
function tt_mp_cleanup(): void {
    global $wpdb;
    $old = tt_now_ms() - TT_MP_EMPTY_ROOM_MS;
    $ids = $wpdb->get_col($wpdb->prepare('SELECT id FROM ' . tt_table('rooms') . ' WHERE updated_at < %d', $old));
    if (!$ids) return;
    $list = implode(',', array_map('intval', $ids));
    $wpdb->query('DELETE FROM ' . tt_table('room_players') . " WHERE room_id IN ($list)");
    $wpdb->query('DELETE FROM ' . tt_table('rooms') . " WHERE id IN ($list)");
}
