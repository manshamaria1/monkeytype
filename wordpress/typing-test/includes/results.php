<?php
defined('ABSPATH') || exit;

/** Achievement thresholds (mirror of shared/achievements.ts). */
function tt_achievement_checks(): array {
    return [
        'first-test' => fn($c) => $c['tests'] >= 1,
        'tests-10' => fn($c) => $c['tests'] >= 10,
        'tests-100' => fn($c) => $c['tests'] >= 100,
        'wpm-40' => fn($c) => $c['bestWpm'] >= 40,
        'wpm-60' => fn($c) => $c['bestWpm'] >= 60,
        'wpm-80' => fn($c) => $c['bestWpm'] >= 80,
        'wpm-100' => fn($c) => $c['bestWpm'] >= 100,
        'wpm-130' => fn($c) => $c['bestWpm'] >= 130,
        'acc-98' => fn($c) => $c['bestQualifiedAccuracy'] >= 98,
        'acc-100' => fn($c) => $c['bestQualifiedAccuracy'] >= 100,
        'streak-3' => fn($c) => $c['longestStreak'] >= 3,
        'streak-7' => fn($c) => $c['longestStreak'] >= 7,
        'streak-30' => fn($c) => $c['longestStreak'] >= 30,
        'words-1k' => fn($c) => $c['totalWords'] >= 1000,
        'words-10k' => fn($c) => $c['totalWords'] >= 10000,
        'words-100k' => fn($c) => $c['totalWords'] >= 100000,
        'lesson-1' => fn($c) => $c['lessonsCompleted'] >= 1,
        'lesson-5' => fn($c) => $c['lessonsCompleted'] >= 5,
        'challenge-1' => fn($c) => $c['challengesCompleted'] >= 1,
        'match-win' => fn($c) => $c['matchWins'] >= 1,
    ];
}

function tt_longest_streak(array $days): int {
    $days = array_values(array_unique($days));
    sort($days);
    $best = $run = 0;
    $prev = null;
    foreach ($days as $d) {
        $t = strtotime($d . ' 00:00:00 UTC');
        $run = ($prev !== null && $t - $prev === 86400) ? $run + 1 : 1;
        $best = max($best, $run);
        $prev = $t;
    }
    return $best;
}

function tt_achievement_context(int $user_id): array {
    global $wpdb;
    $r = tt_table('results');
    $agg = $wpdb->get_row($wpdb->prepare(
        "SELECT COUNT(*) AS tests, COALESCE(MAX(wpm),0) AS best_wpm, COALESCE(SUM(correct_words),0) AS words,
                COALESCE(MAX(CASE WHEN correct_words >= 25 OR (mode = 'time' AND duration_ms >= 30000) THEN accuracy END),0) AS best_acc
           FROM $r WHERE user_id = %d AND failed = 0", $user_id), ARRAY_A);
    $days = $wpdb->get_col($wpdb->prepare("SELECT DISTINCT DATE(created_at) FROM $r WHERE user_id = %d AND failed = 0", $user_id));
    $lessons = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM " . tt_table('lessons') . " WHERE user_id = %d AND completed_at IS NOT NULL", $user_id));
    $wins = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM " . tt_table('match_players') . " WHERE user_id = %d AND outcome = 'win'", $user_id));
    $challenges = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(DISTINCT mode2) FROM $r WHERE user_id = %d AND mode = 'challenge' AND failed = 0", $user_id));
    return [
        'tests' => (int) $agg['tests'],
        'bestWpm' => (float) $agg['best_wpm'],
        'bestQualifiedAccuracy' => (float) $agg['best_acc'],
        'totalWords' => (int) $agg['words'],
        'longestStreak' => tt_longest_streak($days),
        'lessonsCompleted' => $lessons,
        'matchWins' => $wins,
        'challengesCompleted' => $challenges,
    ];
}

/** Store newly earned achievements; returns ids unlocked by this call. */
function tt_update_achievements(int $user_id): array {
    global $wpdb;
    $ctx = tt_achievement_context($user_id);
    $new = [];
    foreach (tt_achievement_checks() as $id => $check) {
        if (!$check($ctx)) continue;
        $n = $wpdb->query($wpdb->prepare("INSERT IGNORE INTO " . tt_table('achievements') . " (user_id, achievement_id, unlocked_at) VALUES (%d, %s, %s)", $user_id, $id, tt_utc_now()));
        if ($n) $new[] = $id;
    }
    return $new;
}

/**
 * Save a verified result with personal record, lesson progress and achievements in one
 * transaction. A repeated client_id returns the stored row instead of a duplicate.
 */
function tt_save_result(int $user_id, array $sub, array $v, bool $imported = false): array {
    global $wpdb;
    $s = $v['stats'];
    $eligible = $v['eligible'] && !$imported;
    $reasons = $v['ineligibleReasons'];
    if ($imported) $reasons[] = "Imported from this device's offline history";
    $created = $imported && isset($sub['finishedAt'])
        ? gmdate('Y-m-d H:i:s', (int) floor(min($sub['finishedAt'], tt_now_ms()) / 1000))
        : tt_utc_now();
    $r = tt_table('results');

    $wpdb->query('START TRANSACTION');
    try {
        $inserted = $wpdb->query($wpdb->prepare(
            "INSERT IGNORE INTO $r (user_id, client_id, mode, mode2, language, word_list_size, punctuation, numbers, difficulty, strict_mode,
                wpm, raw_wpm, accuracy, consistency, correct_chars, incorrect_chars, extra_chars, missed_chars, errors, backspaces,
                correct_words, duration_ms, timeline, key_stats, failed, leaderboard_eligible, ineligible_reasons, imported, created_at)
             VALUES (%d,%s,%s,%s,%s,%s,%d,%d,%s,%d,%f,%f,%f,%f,%d,%d,%d,%d,%d,%d,%d,%d,%s,%s,%d,%d,%s,%d,%s)",
            $user_id, strtolower($sub['clientId']), $sub['mode'], $sub['mode2'], $sub['language'], $sub['wordListSize'],
            $sub['punctuation'] ? 1 : 0, $sub['numbers'] ? 1 : 0, $sub['difficulty'], $sub['strictMode'] ? 1 : 0,
            $s['wpm'], $s['rawWpm'], $s['accuracy'], $s['consistency'], $s['correctChars'], $s['incorrectChars'], $s['extraChars'],
            $s['missedChars'], $s['incorrectKeys'], $s['backspaces'], $s['correctWords'], $s['durationMs'],
            wp_json_encode($v['timeline']), wp_json_encode((object) $v['keyStats']), $v['failed'] ? 1 : 0, $eligible ? 1 : 0,
            wp_json_encode($reasons), $imported ? 1 : 0, $created
        ));
        if ($inserted === false) throw new Exception($wpdb->last_error ?: 'insert failed');
        if ($inserted === 0) {
            $row = $wpdb->get_row($wpdb->prepare("SELECT id, is_pb, leaderboard_eligible, ineligible_reasons FROM $r WHERE user_id = %d AND client_id = %s", $user_id, strtolower($sub['clientId'])), ARRAY_A);
            $wpdb->query('COMMIT');
            return ['id' => (int) $row['id'], 'duplicate' => true, 'isPb' => (bool) $row['is_pb'], 'previousPb' => null, 'eligible' => (bool) $row['leaderboard_eligible'], 'ineligibleReasons' => json_decode($row['ineligible_reasons'], true) ?: [], 'newAchievements' => []];
        }
        $id = (int) $wpdb->insert_id;

        if ($eligible) {
            $wpdb->insert(tt_table('replays'), ['result_id' => $id, 'words' => wp_json_encode($sub['words']), 'events' => wp_json_encode($sub['events'])]);
        }

        $is_pb = false;
        $previous = null;
        if (in_array($sub['mode'], ['time', 'words'], true) && !$v['failed'] && $s['wpm'] > 0) {
            $rec = tt_table('records');
            $key = [$user_id, $sub['mode'], $sub['mode2'], $sub['language'], $sub['punctuation'] ? 1 : 0, $sub['numbers'] ? 1 : 0];
            $prev = $wpdb->get_var($wpdb->prepare("SELECT wpm FROM $rec WHERE user_id=%d AND mode=%s AND mode2=%s AND language=%s AND punctuation=%d AND numbers=%d FOR UPDATE", ...$key));
            $previous = $prev === null ? null : (float) $prev;
            if ($previous === null || $s['wpm'] > $previous) {
                $is_pb = true;
                $wpdb->query($wpdb->prepare(
                    "INSERT INTO $rec (user_id, mode, mode2, language, punctuation, numbers, result_id, wpm, accuracy, raw_wpm, consistency, created_at)
                     VALUES (%d,%s,%s,%s,%d,%d,%d,%f,%f,%f,%f,%s)
                     ON DUPLICATE KEY UPDATE result_id=VALUES(result_id), wpm=VALUES(wpm), accuracy=VALUES(accuracy), raw_wpm=VALUES(raw_wpm), consistency=VALUES(consistency), created_at=VALUES(created_at)",
                    ...array_merge($key, [$id, $s['wpm'], $s['accuracy'], $s['rawWpm'], $s['consistency'], $created])
                ));
                $wpdb->update($r, ['is_pb' => 1], ['id' => $id]);
            }
        }

        $lesson = null;
        if ($sub['mode'] === 'lesson') {
            $def = tt_data()['lessons'][$sub['mode2']];
            $passed = !$v['failed'] && $s['accuracy'] >= $def['passAccuracy'] && $s['wpm'] >= $def['passWpm'];
            $l = tt_table('lessons');
            $before = $wpdb->get_var($wpdb->prepare("SELECT completed_at FROM $l WHERE user_id=%d AND lesson_id=%s FOR UPDATE", $user_id, $sub['mode2']));
            $now = tt_utc_now();
            $wpdb->query($wpdb->prepare(
                "INSERT INTO $l (user_id, lesson_id, attempts, best_wpm, best_accuracy, completed_at, updated_at)
                 VALUES (%d, %s, 1, %f, %f, " . ($passed ? '%s' : 'NULL') . ", %s)
                 ON DUPLICATE KEY UPDATE attempts = attempts + 1, best_wpm = GREATEST(best_wpm, VALUES(best_wpm)),
                   best_accuracy = GREATEST(best_accuracy, VALUES(best_accuracy)), completed_at = COALESCE(completed_at, VALUES(completed_at)), updated_at = VALUES(updated_at)",
                ...($passed ? [$user_id, $sub['mode2'], $s['wpm'], $s['accuracy'], $now, $now] : [$user_id, $sub['mode2'], $s['wpm'], $s['accuracy'], $now])
            ));
            $lesson = ['passed' => $passed, 'firstPass' => $passed && !$before];
        }

        $new = tt_update_achievements($user_id);
        $wpdb->query('COMMIT');
    } catch (Throwable $e) {
        $wpdb->query('ROLLBACK');
        throw $e;
    }
    $out = ['id' => $id, 'duplicate' => false, 'isPb' => $is_pb, 'previousPb' => $previous, 'eligible' => $eligible, 'ineligibleReasons' => $reasons, 'newAchievements' => $new];
    if ($lesson) $out['lesson'] = $lesson;
    return $out;
}

/** Delete every typing-test record of a user (results, records, progress, races, settings). */
function tt_delete_user_data(int $user_id): void {
    global $wpdb;
    $ids = $wpdb->get_col($wpdb->prepare("SELECT id FROM " . tt_table('results') . " WHERE user_id = %d", $user_id));
    if ($ids) $wpdb->query("DELETE FROM " . tt_table('replays') . " WHERE result_id IN (" . implode(',', array_map('intval', $ids)) . ")");
    foreach (['results', 'records', 'achievements', 'lessons', 'goals'] as $t) $wpdb->delete(tt_table($t), ['user_id' => $user_id]);
    $wpdb->query($wpdb->prepare("UPDATE " . tt_table('match_players') . " SET user_id = NULL, guest_name = 'deleted user' WHERE user_id = %d", $user_id));
    foreach (['tt_config', 'tt_config_updated', 'tt_bio', 'tt_avatar', 'tt_country', 'tt_keyboard'] as $k) delete_user_meta($user_id, $k);
}
add_action('deleted_user', 'tt_delete_user_data');
