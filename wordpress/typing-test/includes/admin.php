<?php
/** Settings → Typing Test: setup instructions, requirements check and leaderboard moderation. */
defined('ABSPATH') || exit;

add_action('admin_menu', function () {
    add_options_page('Typing Test', 'Typing Test', 'manage_options', 'typing-test', 'tt_admin_page');
});

add_filter('plugin_action_links_' . plugin_basename(TT_FILE), function ($links) {
    array_unshift($links, '<a href="' . esc_url(admin_url('options-general.php?page=typing-test')) . '">' . esc_html__('Setup', 'typing-test') . '</a>');
    return $links;
});

/** After deleting a result, rebuild that user's personal record for the same test. */
function tt_recompute_record(int $user_id, string $mode, string $mode2, string $language, int $punct, int $nums): void {
    global $wpdb;
    $rec = tt_table('records');
    $wpdb->delete($rec, ['user_id' => $user_id, 'mode' => $mode, 'mode2' => $mode2, 'language' => $language, 'punctuation' => $punct, 'numbers' => $nums]);
    $best = $wpdb->get_row($wpdb->prepare('SELECT id, wpm, accuracy, raw_wpm, consistency, created_at FROM ' . tt_table('results') . ' WHERE user_id=%d AND mode=%s AND mode2=%s AND language=%s AND punctuation=%d AND numbers=%d AND failed=0 ORDER BY wpm DESC, created_at ASC LIMIT 1', $user_id, $mode, $mode2, $language, $punct, $nums), ARRAY_A);
    if ($best) {
        $wpdb->insert($rec, ['user_id' => $user_id, 'mode' => $mode, 'mode2' => $mode2, 'language' => $language, 'punctuation' => $punct, 'numbers' => $nums, 'result_id' => $best['id'], 'wpm' => $best['wpm'], 'accuracy' => $best['accuracy'], 'raw_wpm' => $best['raw_wpm'], 'consistency' => $best['consistency'], 'created_at' => $best['created_at']]);
    }
}

add_action('admin_post_tt_delete_result', function () {
    if (!current_user_can('manage_options')) wp_die('Not allowed', 403);
    $id = (int) ($_POST['result_id'] ?? 0);
    check_admin_referer('tt_delete_result_' . $id);
    global $wpdb;
    $r = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . tt_table('results') . ' WHERE id = %d', $id), ARRAY_A);
    if ($r) {
        $wpdb->delete(tt_table('replays'), ['result_id' => $id]);
        $wpdb->delete(tt_table('results'), ['id' => $id]);
        tt_recompute_record((int) $r['user_id'], $r['mode'], $r['mode2'], $r['language'], (int) $r['punctuation'], (int) $r['numbers']);
    }
    wp_safe_redirect(add_query_arg(['page' => 'typing-test', 'deleted' => $r ? 1 : 0], admin_url('options-general.php')));
    exit;
});

function tt_db_supported(): array {
    global $wpdb;
    $v = $wpdb->get_var('SELECT VERSION()');
    $maria = stripos($v, 'mariadb') !== false;
    $num = preg_replace('/[^0-9.].*$/', '', $v);
    $ok = $maria ? version_compare($num, '10.2', '>=') : version_compare($num, '8.0', '>=');
    return [$ok, $v];
}

function tt_admin_page() {
    global $wpdb;
    [$db_ok, $db_version] = tt_db_supported();
    $rows = $wpdb->get_results('SELECT r.id, r.user_id, r.mode, r.mode2, r.language, r.wpm, r.accuracy, r.created_at, u.display_name
        FROM ' . tt_table('results') . " r LEFT JOIN {$wpdb->users} u ON u.ID = r.user_id
        WHERE r.leaderboard_eligible = 1 ORDER BY r.wpm DESC LIMIT 50", ARRAY_A);
    ?>
    <div class="wrap">
        <h1>Typing Test</h1>
        <?php if (!empty($_GET['deleted'])): ?><div class="notice notice-success"><p>Result deleted.</p></div><?php endif; ?>
        <?php if (!$db_ok): ?>
            <div class="notice notice-error"><p><strong>Leaderboards need MySQL 8.0+ or MariaDB 10.2+.</strong> This site uses <?php echo esc_html($db_version); ?>. Ask your host to upgrade the database.</p></div>
        <?php endif; ?>
        <?php if (!get_option('users_can_register')): ?>
            <div class="notice notice-warning"><p>Visitors cannot create accounts yet. Turn on <a href="<?php echo esc_url(admin_url('options-general.php')); ?>">Settings → General → Membership: "Anyone can register"</a> so people can save results and join leaderboards.</p></div>
        <?php endif; ?>
        <h2>How to add the typing test to a page</h2>
        <ol>
            <li>Go to <strong>Pages → Add New</strong> (or open an existing page).</li>
            <li>Add a <strong>Shortcode</strong> block and type <code>[typing_test]</code>.</li>
            <li>For the full width look, choose a full-width page template if your theme has one.</li>
            <li>Publish. Visitors can type straight away; signing in saves their results, stats and leaderboard places.</li>
        </ol>
        <p>Only the typing test, without leaderboard and other pages: <code>[typing_test view="test"]</code></p>
        <p>Database: <?php echo esc_html($db_version); ?> <?php echo $db_ok ? '✓' : '✗'; ?></p>

        <h2>Top ranked results (moderation)</h2>
        <p>Every result is re-checked on the server from its keystroke log, but no automatic check can prove a person typed it. Delete results you believe are not genuine; the player's personal record is recalculated.</p>
        <table class="widefat striped">
            <thead><tr><th>Player</th><th>Test</th><th>Language</th><th>WPM</th><th>Accuracy</th><th>Date (UTC)</th><th></th></tr></thead>
            <tbody>
            <?php if (!$rows): ?><tr><td colspan="7">No ranked results yet.</td></tr><?php endif; ?>
            <?php foreach ($rows as $r): ?>
                <tr>
                    <td><?php echo esc_html($r['display_name'] ?: '#' . $r['user_id']); ?></td>
                    <td><?php echo esc_html($r['mode'] . ' ' . $r['mode2']); ?></td>
                    <td><?php echo esc_html($r['language']); ?></td>
                    <td><?php echo esc_html($r['wpm']); ?></td>
                    <td><?php echo esc_html($r['accuracy']); ?>%</td>
                    <td><?php echo esc_html($r['created_at']); ?></td>
                    <td>
                        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" onsubmit="return confirm('Delete this result?');">
                            <input type="hidden" name="action" value="tt_delete_result">
                            <input type="hidden" name="result_id" value="<?php echo (int) $r['id']; ?>">
                            <?php wp_nonce_field('tt_delete_result_' . (int) $r['id']); ?>
                            <button class="button button-link-delete">Delete</button>
                        </form>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <?php
}
