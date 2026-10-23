<?php
/** WordPress privacy tools (Tools → Export / Erase Personal Data) for typing-test data. */
defined('ABSPATH') || exit;

add_filter('wp_privacy_personal_data_exporters', function ($exporters) {
    $exporters['typing-test'] = [
        'exporter_friendly_name' => __('Typing Test', 'typing-test'),
        'callback' => function ($email) {
            $u = get_user_by('email', $email);
            if (!$u) return ['data' => [], 'done' => true];
            global $wpdb;
            $rows = $wpdb->get_results($wpdb->prepare('SELECT id, mode, mode2, language, wpm, accuracy, created_at FROM ' . tt_table('results') . ' WHERE user_id = %d ORDER BY created_at', $u->ID), ARRAY_A);
            $items = array_map(fn($r) => [
                'group_id' => 'typing-test-results',
                'group_label' => __('Typing test results', 'typing-test'),
                'item_id' => 'tt-result-' . $r['id'],
                'data' => [
                    ['name' => 'Test', 'value' => $r['mode'] . ' ' . $r['mode2']],
                    ['name' => 'Language', 'value' => $r['language']],
                    ['name' => 'WPM', 'value' => $r['wpm']],
                    ['name' => 'Accuracy', 'value' => $r['accuracy']],
                    ['name' => 'Date (UTC)', 'value' => $r['created_at']],
                ],
            ], $rows);
            return ['data' => $items, 'done' => true];
        },
    ];
    return $exporters;
});

add_filter('wp_privacy_personal_data_erasers', function ($erasers) {
    $erasers['typing-test'] = [
        'eraser_friendly_name' => __('Typing Test', 'typing-test'),
        'callback' => function ($email) {
            $u = get_user_by('email', $email);
            if ($u) tt_delete_user_data($u->ID);
            return ['items_removed' => (bool) $u, 'items_retained' => false, 'messages' => [], 'done' => true];
        },
    ];
    return $erasers;
});

add_action('admin_init', function () {
    if (function_exists('wp_add_privacy_policy_content')) {
        wp_add_privacy_policy_content('Typing Test', wp_kses_post(
            '<p>When signed-in visitors take typing tests we store their results (speed, accuracy, keystroke timing statistics, and for leaderboard results the keystroke log so results can be checked), personal records, lesson progress, achievements, race results and typing settings. Visitors who are not signed in keep their results only in their own browser. Profile details (avatar, country, keyboard, short bio) are optional and shown on public profiles and leaderboards.</p>'
        ));
    }
});
