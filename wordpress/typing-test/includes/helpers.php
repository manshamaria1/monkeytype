<?php
defined('ABSPATH') || exit;

function tt_now_ms(): int {
    return (int) round(microtime(true) * 1000);
}

/** Current UTC time in MySQL DATETIME format. */
function tt_utc_now(): string {
    return gmdate('Y-m-d H:i:s');
}

/** MySQL UTC DATETIME -> ISO 8601 for the browser. */
function tt_iso(?string $dt): ?string {
    if (!$dt) return null;
    return gmdate('Y-m-d\TH:i:s\Z', strtotime($dt . ' UTC'));
}

function tt_error(string $message, int $status = 400): WP_Error {
    return new WP_Error('typing_test_error', $message, ['status' => $status]);
}

/**
 * Fixed-window rate limit stored in transients (works on any host; with a persistent
 * object cache it is shared across PHP workers).
 */
function tt_rate_limit(string $name, int $max, int $window_seconds): ?WP_Error {
    $who = get_current_user_id() ?: md5($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $key = 'tt_rl_' . md5($name . '|' . $who . '|' . floor(time() / $window_seconds));
    $count = (int) get_transient($key);
    if ($count >= $max) return tt_error('Too many requests. Please wait a moment and try again.', 429);
    set_transient($key, $count + 1, $window_seconds);
    return null;
}

/** Cast DB row values: numeric strings to numbers, flags to booleans, dates to ISO. */
function tt_cast_row(array $row): array {
    static $bools = ['punctuation', 'numbers', 'strict_mode', 'failed', 'leaderboard_eligible', 'is_pb', 'imported', 'finished'];
    static $floats = ['wpm', 'raw_wpm', 'accuracy', 'consistency', 'best_wpm', 'best_accuracy', 'avg_wpm', 'avg_accuracy', 'avg_consistency', 'best_accuracy', 'progress'];
    static $dates = ['created_at', 'unlocked_at', 'completed_at', 'updated_at', 'started_at', 'ended_at'];
    static $ints = ['id', 'result_id', 'tests', 'correct_chars', 'incorrect_chars', 'extra_chars', 'missed_chars', 'errors', 'backspaces',
        'correct_words', 'duration_ms', 'attempts', 'place', 'players', 'word_count', 'finish_ms', 'seat', 'rank', 'total',
        'daily_tests', 'daily_minutes', 'target_wpm'];
    foreach ($row as $k => $v) {
        if ($v === null) continue;
        if (in_array($k, $bools, true)) $row[$k] = (bool) (int) $v;
        elseif (in_array($k, $floats, true)) $row[$k] = (float) $v;
        elseif (in_array($k, $dates, true)) $row[$k] = tt_iso($v);
        elseif (in_array($k, $ints, true)) $row[$k] = (int) $v;
    }
    foreach (['timeline', 'key_stats'] as $k) {
        if (isset($row[$k]) && is_string($row[$k])) $row[$k] = json_decode($row[$k], true) ?: (object) [];
    }
    if (isset($row['ineligible_reasons']) && is_string($row['ineligible_reasons'])) {
        $row['ineligible_reasons'] = json_decode($row['ineligible_reasons'], true) ?: [];
    }
    return $row;
}

function tt_rows(array $rows): array {
    return array_map('tt_cast_row', $rows);
}

function tt_avatar_of(int $user_id): string {
    $a = get_user_meta($user_id, 'tt_avatar', true);
    return is_string($a) && isset(tt_data()['avatars'][$a]) ? $a : 'monkey';
}

function tt_avatar_emoji(string $id): string {
    return tt_data()['avatars'][$id] ?? '🐒';
}

/** The user object the browser app expects. "username" is the public display name; "slug" is used in profile links. */
function tt_user_payload(WP_User $u): array {
    return [
        'id' => $u->ID,
        'username' => $u->display_name ?: $u->user_nicename,
        'slug' => $u->user_nicename,
        'email' => $u->user_email,
        'emailVerified' => true,
    ];
}

/** Read JSON body as array. */
function tt_body(WP_REST_Request $r): array {
    $b = $r->get_json_params();
    return is_array($b) ? $b : [];
}

