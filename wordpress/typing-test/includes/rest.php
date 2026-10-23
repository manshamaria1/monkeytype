<?php
/**
 * REST API at /wp-json/typing-test/v1/... mirroring the Node server's /api/... routes,
 * so the same browser app works on both. Signed-in requests use WordPress cookie
 * authentication with the wp_rest nonce.
 */
defined('ABSPATH') || exit;

const TT_NS = 'typing-test/v1';

function tt_logged_in() {
    return is_user_logged_in() ? true : tt_error('Please sign in to continue.', 401);
}

add_action('rest_api_init', function () {
    $pub = '__return_true';
    $auth = 'tt_logged_in';
    $routes = [
        ['/auth/me', 'GET', 'tt_rest_me', $pub],
        ['/results/verify', 'POST', 'tt_rest_verify', $pub],
        ['/results', 'POST', 'tt_rest_save', $auth],
        ['/results/import', 'POST', 'tt_rest_import', $auth],
        ['/leaderboard/rules', 'GET', fn() => tt_data()['leaderboard'], $pub],
        ['/leaderboard', 'GET', 'tt_rest_leaderboard', $pub],
        ['/leaderboard/rank', 'GET', 'tt_rest_rank', $auth],
        ['/me/preferences', 'GET', 'tt_rest_get_prefs', $auth],
        ['/me/preferences', 'PUT', 'tt_rest_put_prefs', $auth],
        ['/me/profile', 'GET', 'tt_rest_get_profile', $auth],
        ['/me/profile', 'PATCH', 'tt_rest_patch_profile', $auth],
        ['/me/export', 'GET', 'tt_rest_export', $auth],
        ['/me/data', 'DELETE', 'tt_rest_delete_data', $auth],
        ['/me/results', 'GET', 'tt_rest_results', $auth],
        ['/me/results/(?P<id>\d+)', 'GET', 'tt_rest_result', $auth],
        ['/me/stats', 'GET', 'tt_rest_stats', $auth],
        ['/me/weak-keys', 'GET', 'tt_rest_weak_keys', $auth],
        ['/me/achievements', 'GET', 'tt_rest_achievements', $auth],
        ['/me/lessons', 'GET', 'tt_rest_lessons', $auth],
        ['/me/goals', 'GET', 'tt_rest_get_goals', $auth],
        ['/me/goals', 'PUT', 'tt_rest_put_goals', $auth],
        ['/me/challenges', 'GET', 'tt_rest_challenges', $auth],
        ['/me/matches', 'GET', 'tt_rest_matches', $auth],
        ['/users/(?P<slug>[A-Za-z0-9_.-]{1,60})', 'GET', 'tt_rest_user', $pub], // no '@': WordPress uses it as the regex delimiter
    ];
    foreach ($routes as [$path, $method, $cb, $perm]) {
        register_rest_route(TT_NS, $path, ['methods' => $method, 'callback' => $cb, 'permission_callback' => $perm]);
    }
});

// ---------------------------------------------------------------- auth & results

function tt_rest_me() {
    $u = wp_get_current_user();
    return ['user' => $u->exists() ? tt_user_payload($u) : null];
}

function tt_rest_verify(WP_REST_Request $r) {
    if ($e = tt_rate_limit('results', 40, 60)) return $e;
    [$sub, $err] = tt_parse_submission(tt_body($r));
    if ($err) return tt_error($err, 400);
    $out = tt_verify_submission($sub);
    if (!$out['ok']) return tt_error($out['error'], 422);
    return ['eligible' => $out['result']['eligible'], 'ineligibleReasons' => $out['result']['ineligibleReasons']];
}

function tt_rest_save(WP_REST_Request $r) {
    if ($e = tt_rate_limit('results', 40, 60)) return $e;
    [$sub, $err] = tt_parse_submission(tt_body($r));
    if ($err) return tt_error($err, 400);
    $out = tt_verify_submission($sub);
    if (!$out['ok']) return tt_error($out['error'], 422);
    $saved = tt_save_result(get_current_user_id(), $sub, $out['result']);
    return new WP_REST_Response($saved + ['stats' => $out['result']['stats']], $saved['duplicate'] ? 200 : 201);
}

function tt_rest_import(WP_REST_Request $r) {
    if ($e = tt_rate_limit('import', 5, 60)) return $e;
    $list = tt_body($r)['results'] ?? null;
    if (!is_array($list) || count($list) > 100) return tt_error('results: Invalid', 400);
    $imported = $skipped = 0;
    foreach ($list as $raw) {
        [$sub, $err] = tt_parse_submission($raw);
        $out = $err ? null : tt_verify_submission($sub);
        if (!$out || !$out['ok']) { $skipped++; continue; }
        $saved = tt_save_result(get_current_user_id(), $sub, $out['result'], true);
        $saved['duplicate'] ? $skipped++ : $imported++;
    }
    return ['imported' => $imported, 'skipped' => $skipped];
}

// ---------------------------------------------------------------- leaderboard

/** UTC start of the period (weeks start on Monday). */
function tt_period_start(string $period): ?string {
    $now = time();
    switch ($period) {
        case 'daily': return gmdate('Y-m-d 00:00:00', $now);
        case 'weekly':
            $dow = ((int) gmdate('N', $now)) - 1;
            return gmdate('Y-m-d 00:00:00', $now - $dow * 86400);
        case 'monthly': return gmdate('Y-m-01 00:00:00', $now);
    }
    return null;
}

function tt_board_query(WP_REST_Request $r) {
    $period = $r->get_param('period') ?: 'alltime';
    $mode = $r->get_param('mode') ?: 'time';
    $mode2 = (string) ($r->get_param('mode2') ?: '60');
    $language = $r->get_param('language') ?: 'english';
    $country = strtoupper((string) $r->get_param('country'));
    if (!in_array($period, ['daily', 'weekly', 'monthly', 'alltime'], true)) return tt_error('period: Invalid option');
    if (!in_array($mode, ['time', 'words'], true)) return tt_error('mode: Invalid option');
    $lb = tt_data()['leaderboard'];
    $allowed = $mode === 'time' ? $lb['timeModes'] : $lb['wordModes'];
    if (!ctype_digit($mode2) || !in_array((int) $mode2, $allowed, true)) return tt_error('This test length has no leaderboard');
    if (!tt_is_language($language)) return tt_error('Unknown language');
    if ($country !== '' && !preg_match('/^[A-Z]{2}$/', $country)) return tt_error('country: Invalid');
    return compact('period', 'mode', 'mode2', 'language', 'country');
}

/** Best eligible result per user, ranked by WPM, accuracy, then the earlier result. Needs MySQL 8 / MariaDB 10.2+. */
function tt_ranked_cte(array $q): array {
    global $wpdb;
    $r = tt_table('results');
    $join = '';
    $params = [$q['mode'], $q['mode2'], $q['language']];
    if ($q['country'] !== '') {
        $join = "JOIN {$wpdb->usermeta} cm ON cm.user_id = r.user_id AND cm.meta_key = 'tt_country' AND cm.meta_value = %s";
        array_unshift($params, $q['country']);
    }
    $since = tt_period_start($q['period']);
    $where = $since ? 'AND r.created_at >= %s' : '';
    if ($since) $params[] = $since;
    $sql = "WITH best AS (
        SELECT r.user_id, r.id, r.wpm, r.raw_wpm, r.accuracy, r.consistency, r.created_at,
               ROW_NUMBER() OVER (PARTITION BY r.user_id ORDER BY r.wpm DESC, r.accuracy DESC, r.created_at ASC, r.id ASC) AS rn
          FROM $r r $join
         WHERE r.leaderboard_eligible = 1 AND r.mode = %s AND r.mode2 = %s AND r.language = %s $where
      ), ranked AS (
        SELECT best.*, ROW_NUMBER() OVER (ORDER BY wpm DESC, accuracy DESC, created_at ASC, id ASC) AS rnk FROM best WHERE rn = 1
      )";
    return [$sql, $params];
}

function tt_rest_leaderboard(WP_REST_Request $r) {
    global $wpdb;
    $q = tt_board_query($r);
    if (is_wp_error($q)) return $q;
    $page = max(1, min(10000, (int) ($r->get_param('page') ?: 1)));
    $size = max(1, min(100, (int) ($r->get_param('pageSize') ?: 50)));
    [$cte, $params] = tt_ranked_cte($q);
    $search = trim((string) $r->get_param('search'));
    $where = '';
    if ($search !== '') {
        $where = 'WHERE u.display_name LIKE %s';
        $params[] = '%' . $wpdb->esc_like(mb_substr($search, 0, 40)) . '%';
    }
    $params[] = $size;
    $params[] = ($page - 1) * $size;
    $rec = tt_table('records');
    $rows = $wpdb->get_results($wpdb->prepare(
        "$cte
         SELECT ranked.rnk AS `rank`, ranked.id AS result_id, ranked.wpm, ranked.raw_wpm, ranked.accuracy, ranked.consistency, ranked.created_at,
                u.display_name AS username, u.user_nicename AS slug, am.meta_value AS avatar, cm2.meta_value AS country,
                (pr.result_id IS NOT NULL) AS is_pb, COUNT(*) OVER () AS total
           FROM ranked
           JOIN {$wpdb->users} u ON u.ID = ranked.user_id
           LEFT JOIN {$wpdb->usermeta} am ON am.user_id = ranked.user_id AND am.meta_key = 'tt_avatar'
           LEFT JOIN {$wpdb->usermeta} cm2 ON cm2.user_id = ranked.user_id AND cm2.meta_key = 'tt_country'
           LEFT JOIN $rec pr ON pr.result_id = ranked.id
           $where
          ORDER BY ranked.rnk LIMIT %d OFFSET %d", ...$params), ARRAY_A);
    if ($wpdb->last_error) return tt_error('Leaderboards need MySQL 8.0+ or MariaDB 10.2+.', 500);
    $total = $rows ? (int) $rows[0]['total'] : 0;
    $entries = array_map(function ($row) {
        unset($row['total']);
        $row = tt_cast_row($row);
        $row['avatar'] = $row['avatar'] ?: 'monkey';
        $row['is_pb'] = (bool) $row['is_pb'];
        return $row;
    }, $rows);
    $since = tt_period_start($q['period']);
    return ['entries' => $entries, 'total' => $total, 'page' => $page, 'pageSize' => $size, 'periodStart' => $since ? tt_iso($since) : null];
}

function tt_rest_rank(WP_REST_Request $r) {
    global $wpdb;
    $q = tt_board_query($r);
    if (is_wp_error($q)) return $q;
    [$cte, $params] = tt_ranked_cte($q);
    $params[] = get_current_user_id();
    $row = $wpdb->get_row($wpdb->prepare(
        "$cte SELECT rnk AS `rank`, wpm, accuracy, created_at, (SELECT COUNT(*) FROM ranked) AS total FROM ranked WHERE user_id = %d", ...$params), ARRAY_A);
    return ['entry' => $row ? tt_cast_row($row) : null];
}

// ---------------------------------------------------------------- preferences & profile

function tt_rest_get_prefs() {
    $uid = get_current_user_id();
    $raw = get_user_meta($uid, 'tt_config', true);
    $cfg = $raw ? json_decode($raw, true) : null;
    $ms = (int) get_user_meta($uid, 'tt_config_updated', true);
    return ['config' => is_array($cfg) ? $cfg : null, 'updatedAt' => $ms ? gmdate('Y-m-d\TH:i:s.v\Z', (int) ($ms / 1000)) : null];
}

function tt_rest_put_prefs(WP_REST_Request $r) {
    if ($e = tt_rate_limit('prefs', 60, 60)) return $e;
    $cfg = tt_body($r)['config'] ?? null;
    // The browser re-validates every field when loading; here we only bound the size and shape.
    if (!is_array($cfg) || array_values($cfg) === $cfg) return tt_error('config: Expected object');
    $json = wp_json_encode($cfg);
    if (strlen($json) > 20000) return tt_error('config: Too large');
    $uid = get_current_user_id();
    update_user_meta($uid, 'tt_config', wp_slash($json));
    update_user_meta($uid, 'tt_config_updated', tt_now_ms());
    return ['ok' => true];
}

function tt_profile_of(WP_User $u): array {
    return [
        'username' => $u->display_name,
        'email' => $u->user_email,
        'email_verified' => true,
        'created_at' => tt_iso($u->user_registered),
        'bio' => (string) get_user_meta($u->ID, 'tt_bio', true),
        'avatar' => tt_avatar_of($u->ID),
        'country' => get_user_meta($u->ID, 'tt_country', true) ?: null,
        'keyboard' => (string) get_user_meta($u->ID, 'tt_keyboard', true),
    ];
}

function tt_rest_get_profile() {
    return tt_profile_of(wp_get_current_user());
}

function tt_rest_patch_profile(WP_REST_Request $r) {
    $b = tt_body($r);
    $uid = get_current_user_id();
    if (array_key_exists('bio', $b)) {
        if (!is_string($b['bio']) || mb_strlen($b['bio']) > 300) return tt_error('bio: Too long');
        update_user_meta($uid, 'tt_bio', sanitize_textarea_field($b['bio']));
    }
    if (array_key_exists('avatar', $b)) {
        if (!is_string($b['avatar']) || !isset(tt_data()['avatars'][$b['avatar']])) return tt_error('avatar: Invalid option');
        update_user_meta($uid, 'tt_avatar', $b['avatar']);
    }
    if (array_key_exists('country', $b)) {
        if ($b['country'] === null || $b['country'] === '') delete_user_meta($uid, 'tt_country');
        elseif (is_string($b['country']) && preg_match('/^[A-Za-z]{2}$/', $b['country'])) update_user_meta($uid, 'tt_country', strtoupper($b['country']));
        else return tt_error('country: Use a two-letter country code');
    }
    if (array_key_exists('keyboard', $b)) {
        if (!is_string($b['keyboard']) || mb_strlen($b['keyboard']) > 60) return tt_error('keyboard: Too long');
        update_user_meta($uid, 'tt_keyboard', sanitize_text_field($b['keyboard']));
    }
    return ['ok' => true];
}

const TT_RESULT_COLUMNS = 'id, mode, mode2, language, word_list_size, punctuation, numbers, difficulty, strict_mode, wpm, raw_wpm, accuracy, consistency, correct_chars, incorrect_chars, extra_chars, missed_chars, errors, backspaces, correct_words, duration_ms, failed, leaderboard_eligible, ineligible_reasons, is_pb, imported, created_at';

function tt_rest_export() {
    global $wpdb;
    $uid = get_current_user_id();
    $u = wp_get_current_user();
    $q = fn($sql) => tt_rows($wpdb->get_results($wpdb->prepare($sql, $uid), ARRAY_A));
    $raw = get_user_meta($uid, 'tt_config', true);
    $data = [
        'exportedAt' => gmdate('c'),
        'profile' => tt_profile_of($u),
        'preferences' => $raw ? json_decode($raw, true) : null,
        'results' => $q("SELECT " . TT_RESULT_COLUMNS . ", timeline, key_stats FROM " . tt_table('results') . " WHERE user_id = %d ORDER BY created_at"),
        'personalRecords' => $q("SELECT mode, mode2, language, punctuation, numbers, wpm, accuracy, raw_wpm, consistency, created_at FROM " . tt_table('records') . " WHERE user_id = %d"),
        'achievements' => $q("SELECT achievement_id, unlocked_at FROM " . tt_table('achievements') . " WHERE user_id = %d"),
        'lessons' => $q("SELECT lesson_id, attempts, best_wpm, best_accuracy, completed_at FROM " . tt_table('lessons') . " WHERE user_id = %d"),
        'goals' => $q("SELECT daily_tests, daily_minutes, target_wpm FROM " . tt_table('goals') . " WHERE user_id = %d")[0] ?? null,
        'matches' => $q("SELECT m.started_at, m.language, mp.place, mp.outcome, mp.wpm, mp.accuracy FROM " . tt_table('match_players') . " mp JOIN " . tt_table('matches') . " m ON m.id = mp.match_id WHERE mp.user_id = %d ORDER BY m.started_at"),
    ];
    $res = new WP_REST_Response($data);
    $res->header('Content-Disposition', 'attachment; filename="typing-test-' . sanitize_file_name($u->user_nicename) . '.json"');
    return $res;
}

function tt_rest_delete_data() {
    if ($e = tt_rate_limit('delete', 5, 60)) return $e;
    tt_delete_user_data(get_current_user_id());
    return ['ok' => true];
}

// ---------------------------------------------------------------- history & statistics

/** Shared WHERE for history/stats filters. Returns [sql, params]. */
function tt_filters(WP_REST_Request $r): array {
    $where = ['user_id = %d'];
    $params = [get_current_user_id()];
    foreach (['mode' => 20, 'mode2' => 40, 'language' => 40] as $k => $max) {
        $v = $r->get_param($k);
        if (is_string($v) && $v !== '' && mb_strlen($v) <= $max) {
            $where[] = "$k = %s";
            $params[] = $v;
        }
    }
    foreach (['from' => '>=', 'to' => '<'] as $k => $op) {
        $v = $r->get_param($k);
        if (is_string($v) && $v !== '' && ($ts = strtotime($v)) !== false) {
            $where[] = "created_at $op %s";
            $params[] = gmdate('Y-m-d H:i:s', $ts);
        }
    }
    return [implode(' AND ', $where), $params];
}

function tt_rest_results(WP_REST_Request $r) {
    global $wpdb;
    [$where, $params] = tt_filters($r);
    $limit = max(1, min(100, (int) ($r->get_param('limit') ?: 25)));
    $offset = max(0, (int) $r->get_param('offset'));
    $t = tt_table('results');
    $total = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM $t WHERE $where", ...$params));
    $rows = $wpdb->get_results($wpdb->prepare("SELECT " . TT_RESULT_COLUMNS . " FROM $t WHERE $where ORDER BY created_at DESC, id DESC LIMIT %d OFFSET %d", ...array_merge($params, [$limit, $offset])), ARRAY_A);
    return ['results' => tt_rows($rows), 'total' => $total];
}

function tt_rest_result(WP_REST_Request $r) {
    global $wpdb;
    $row = $wpdb->get_row($wpdb->prepare("SELECT " . TT_RESULT_COLUMNS . ", timeline, key_stats FROM " . tt_table('results') . " WHERE id = %d AND user_id = %d", (int) $r['id'], get_current_user_id()), ARRAY_A);
    return $row ? tt_cast_row($row) : tt_error('Result not found', 404);
}

function tt_rest_stats(WP_REST_Request $r) {
    global $wpdb;
    [$where, $params] = tt_filters($r);
    $t = tt_table('results');
    $ok = "$where AND failed = 0";
    $q = fn($sql) => $wpdb->get_results($wpdb->prepare($sql, ...$params), ARRAY_A);
    $totals = $q("SELECT COUNT(*) AS tests, COALESCE(MAX(wpm),0) AS best_wpm, COALESCE(ROUND(AVG(wpm),2),0) AS avg_wpm,
                         COALESCE(MAX(accuracy),0) AS best_accuracy, COALESCE(ROUND(AVG(accuracy),2),0) AS avg_accuracy,
                         COALESCE(ROUND(AVG(consistency),2),0) AS avg_consistency,
                         COALESCE(SUM(correct_chars + incorrect_chars + extra_chars),0) AS chars_typed,
                         COALESCE(SUM(correct_words),0) AS words_typed, COALESCE(SUM(duration_ms),0) AS time_ms
                    FROM $t WHERE $ok")[0];
    $failed = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM $t WHERE $where AND failed = 1", ...$params));
    $by_lang = $q("SELECT language, COUNT(*) AS tests, ROUND(AVG(wpm),2) AS avg_wpm, MAX(wpm) AS best_wpm, ROUND(AVG(accuracy),2) AS avg_accuracy FROM $t WHERE $ok GROUP BY language ORDER BY tests DESC");
    $by_mode = $q("SELECT mode, mode2, COUNT(*) AS tests, ROUND(AVG(wpm),2) AS avg_wpm, MAX(wpm) AS best_wpm, ROUND(AVG(accuracy),2) AS avg_accuracy FROM $t WHERE $ok GROUP BY mode, mode2 ORDER BY tests DESC LIMIT 30");
    $daily = $q("SELECT DATE_FORMAT(created_at, '%%Y-%%m-%%d') AS day, COUNT(*) AS tests, ROUND(AVG(wpm),2) AS avg_wpm, MAX(wpm) AS best_wpm,
                        ROUND(AVG(accuracy),2) AS avg_accuracy, ROUND(AVG(consistency),2) AS avg_consistency
                   FROM $t WHERE $ok GROUP BY day ORDER BY day DESC LIMIT 120");
    $records = $wpdb->get_results($wpdb->prepare("SELECT mode, mode2, language, punctuation, numbers, wpm, accuracy, raw_wpm, consistency, created_at, result_id FROM " . tt_table('records') . " WHERE user_id = %d ORDER BY mode, CAST(mode2 AS UNSIGNED), language", get_current_user_id()), ARRAY_A);
    $tot = tt_cast_row($totals);
    foreach (['tests', 'chars_typed', 'words_typed', 'time_ms'] as $k) $tot[$k] = (int) $totals[$k];
    foreach (['best_wpm', 'best_accuracy'] as $k) $tot[$k] = (float) $totals[$k];
    $tot['failed_tests'] = $failed;
    $cast = fn($rows) => array_map(function ($row) {
        $row = tt_cast_row($row);
        foreach (['tests'] as $k) if (isset($row[$k])) $row[$k] = (int) $row[$k];
        if (isset($row['mode2'])) $row['mode2'] = (string) $row['mode2'];
        return $row;
    }, $rows);
    return [
        'totals' => $tot,
        'byLanguage' => $cast($by_lang),
        'byMode' => $cast($by_mode),
        'daily' => array_reverse(array_map(fn($d) => ['day' => $d['day']] + tt_cast_row(array_diff_key($d, ['day' => 1])), $daily)),
        'records' => $cast($records),
    ];
}

function tt_rest_weak_keys() {
    global $wpdb;
    $rows = $wpdb->get_col($wpdb->prepare("SELECT key_stats FROM " . tt_table('results') . " WHERE user_id = %d AND language = 'english' ORDER BY created_at DESC LIMIT 50", get_current_user_id()));
    $agg = [];
    foreach ($rows as $json) {
        foreach ((json_decode($json, true) ?: []) as $k => $v) {
            $k = (string) $k;
            if (!preg_match('/^[a-z]$/', $k)) continue;
            $agg[$k] ??= ['hit' => 0, 'miss' => 0];
            $agg[$k]['hit'] += (int) $v['hit'];
            $agg[$k]['miss'] += (int) $v['miss'];
        }
    }
    $keys = [];
    foreach ($agg as $k => $v) {
        if ($v['hit'] + $v['miss'] < 10) continue;
        $keys[] = ['key' => $k, 'hit' => $v['hit'], 'miss' => $v['miss'], 'missRate' => $v['miss'] / ($v['hit'] + $v['miss'])];
    }
    usort($keys, fn($a, $b) => $b['missRate'] <=> $a['missRate']);
    return ['keys' => $keys, 'testsAnalysed' => count($rows)];
}

function tt_rest_achievements() {
    global $wpdb;
    $rows = $wpdb->get_results($wpdb->prepare("SELECT achievement_id, unlocked_at FROM " . tt_table('achievements') . " WHERE user_id = %d", get_current_user_id()), ARRAY_A);
    $got = [];
    foreach ($rows as $row) $got[$row['achievement_id']] = tt_iso($row['unlocked_at']);
    return ['achievements' => array_map(fn($a) => $a + ['unlockedAt' => $got[$a['id']] ?? null], tt_data()['achievements'])];
}

function tt_rest_lessons() {
    global $wpdb;
    $rows = $wpdb->get_results($wpdb->prepare("SELECT lesson_id, attempts, best_wpm, best_accuracy, completed_at FROM " . tt_table('lessons') . " WHERE user_id = %d", get_current_user_id()), ARRAY_A);
    return ['progress' => tt_rows($rows), 'total' => count(tt_data()['lessons'])];
}

function tt_rest_get_goals() {
    global $wpdb;
    $uid = get_current_user_id();
    $g = $wpdb->get_row($wpdb->prepare("SELECT daily_tests, daily_minutes, target_wpm FROM " . tt_table('goals') . " WHERE user_id = %d", $uid), ARRAY_A);
    $today = $wpdb->get_row($wpdb->prepare("SELECT COUNT(*) AS tests, COALESCE(SUM(duration_ms),0) AS ms, COALESCE(MAX(wpm),0) AS best FROM " . tt_table('results') . " WHERE user_id = %d AND failed = 0 AND created_at >= %s", $uid, gmdate('Y-m-d 00:00:00')), ARRAY_A);
    return [
        'goals' => $g ? array_map('intval', $g) : null,
        'today' => ['tests' => (int) $today['tests'], 'minutes' => round(((int) $today['ms']) / 6000) / 10, 'bestWpm' => (float) $today['best']],
    ];
}

function tt_rest_put_goals(WP_REST_Request $r) {
    global $wpdb;
    $b = tt_body($r);
    $limits = ['daily_tests' => 500, 'daily_minutes' => 600, 'target_wpm' => 400];
    foreach ($limits as $k => $max) {
        if (!isset($b[$k]) || !is_int($b[$k]) || $b[$k] < 0 || $b[$k] > $max) return tt_error("$k: Must be a whole number from 0 to $max");
    }
    $wpdb->query($wpdb->prepare("INSERT INTO " . tt_table('goals') . " (user_id, daily_tests, daily_minutes, target_wpm) VALUES (%d,%d,%d,%d)
        ON DUPLICATE KEY UPDATE daily_tests=VALUES(daily_tests), daily_minutes=VALUES(daily_minutes), target_wpm=VALUES(target_wpm)",
        get_current_user_id(), $b['daily_tests'], $b['daily_minutes'], $b['target_wpm']));
    return ['ok' => true];
}

function tt_rest_challenges() {
    global $wpdb;
    $rows = $wpdb->get_results($wpdb->prepare("SELECT mode2 AS date, MAX(wpm) AS best_wpm, MAX(accuracy) AS best_accuracy, COUNT(*) AS attempts FROM " . tt_table('results') . " WHERE user_id = %d AND mode = 'challenge' AND failed = 0 GROUP BY mode2 ORDER BY mode2 DESC LIMIT 60", get_current_user_id()), ARRAY_A);
    return ['challenges' => array_map(fn($row) => ['date' => $row['date']] + tt_cast_row(array_diff_key($row, ['date' => 1])), $rows)];
}

function tt_rest_matches() {
    global $wpdb;
    $uid = get_current_user_id();
    $mp = tt_table('match_players');
    $m = tt_table('matches');
    $rows = $wpdb->get_results($wpdb->prepare(
        "SELECT m.id, m.started_at, m.language, JSON_LENGTH(m.words) AS word_count, mp.place, mp.outcome, mp.wpm, mp.accuracy,
                (SELECT COUNT(*) FROM $mp x WHERE x.match_id = m.id) AS players
           FROM $mp mp JOIN $m m ON m.id = mp.match_id WHERE mp.user_id = %d ORDER BY m.started_at DESC LIMIT 50", $uid), ARRAY_A);
    $s = $wpdb->get_row($wpdb->prepare(
        "SELECT SUM(outcome='win') AS wins, SUM(outcome='loss') AS losses, SUM(outcome='draw') AS draws, SUM(outcome='dnf') AS dnf FROM $mp WHERE user_id = %d", $uid), ARRAY_A);
    return ['matches' => tt_rows($rows), 'summary' => array_map('intval', $s)];
}

function tt_rest_user(WP_REST_Request $r) {
    global $wpdb;
    $u = get_user_by('slug', sanitize_title((string) $r['slug']));
    if (!$u) return tt_error('User not found', 404);
    $records = $wpdb->get_results($wpdb->prepare("SELECT mode, mode2, language, wpm, accuracy, created_at FROM " . tt_table('records') . " WHERE user_id = %d AND punctuation = 0 AND numbers = 0 ORDER BY mode, CAST(mode2 AS UNSIGNED)", $u->ID), ARRAY_A);
    $tot = $wpdb->get_row($wpdb->prepare("SELECT COUNT(*) AS tests, COALESCE(SUM(duration_ms),0) AS ms, COALESCE(SUM(correct_words),0) AS words FROM " . tt_table('results') . " WHERE user_id = %d AND failed = 0", $u->ID), ARRAY_A);
    $ach = $wpdb->get_results($wpdb->prepare("SELECT achievement_id, unlocked_at FROM " . tt_table('achievements') . " WHERE user_id = %d ORDER BY unlocked_at", $u->ID), ARRAY_A);
    $defs = [];
    foreach (tt_data()['achievements'] as $a) $defs[$a['id']] = $a;
    $m = $wpdb->get_row($wpdb->prepare("SELECT SUM(outcome='win') AS wins, SUM(outcome='loss') AS losses, SUM(outcome='draw') AS draws FROM " . tt_table('match_players') . " WHERE user_id = %d", $u->ID), ARRAY_A);
    return [
        'username' => $u->display_name,
        'joined' => tt_iso($u->user_registered),
        'bio' => (string) get_user_meta($u->ID, 'tt_bio', true),
        'avatar' => tt_avatar_of($u->ID),
        'country' => get_user_meta($u->ID, 'tt_country', true) ?: null,
        'keyboard' => (string) get_user_meta($u->ID, 'tt_keyboard', true),
        'records' => array_map(fn($row) => ['mode2' => (string) $row['mode2']] + tt_cast_row($row), $records),
        'totals' => ['tests' => (int) $tot['tests'], 'timeMs' => (int) $tot['ms'], 'words' => (int) $tot['words']],
        'achievements' => array_values(array_filter(array_map(fn($a) => isset($defs[$a['achievement_id']]) ? $defs[$a['achievement_id']] + ['unlockedAt' => tt_iso($a['unlocked_at'])] : null, $ach))),
        'matches' => array_map('intval', $m),
    ];
}
