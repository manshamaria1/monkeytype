<?php
defined('ABSPATH') || exit;

/**
 * [typing_test]            full app: test, leaderboard, multiplayer, stats, practice, settings, profile
 * [typing_test view="test"] only the typing test
 */
add_shortcode('typing_test', function ($atts) {
    $atts = shortcode_atts(['view' => 'full'], $atts, 'typing_test');
    static $done = false;
    if ($done) return '<p>' . esc_html__('Only one typing test can be shown per page.', 'typing-test') . '</p>';
    $done = true;

    $url = plugins_url('assets/', TT_FILE);
    wp_enqueue_style('typing-test', $url . 'app.css', [], TT_VERSION);
    wp_enqueue_script('typing-test', $url . 'app.js', [], TT_VERSION, true);

    $u = wp_get_current_user();
    $here = get_permalink() ?: home_url('/');
    $config = [
        'restUrl' => esc_url_raw(rest_url(TT_NS . '/')),
        'nonce' => $u->exists() ? wp_create_nonce('wp_rest') : null,
        'ajaxUrl' => admin_url('admin-ajax.php'),
        'user' => $u->exists() ? tt_user_payload($u) : null,
        'loginUrl' => wp_login_url($here),
        'registerUrl' => get_option('users_can_register') ? wp_registration_url() : null,
        'lostPasswordUrl' => wp_lostpassword_url($here),
        'logoutUrl' => wp_logout_url($here),
        'profileUrl' => admin_url('profile.php'),
        'privacyUrl' => get_privacy_policy_url() ?: null,
        'siteName' => get_bloginfo('name'),
        'view' => $atts['view'] === 'test' ? 'test' : 'full',
    ];
    wp_add_inline_script('typing-test', 'window.TypingTestWP = ' . wp_json_encode($config) . ';', 'before');
    // alignwide: block themes give the app the wide content width instead of the narrow text column.
    return '<div id="typing-test-root" class="tt-root alignwide wp-exclude-emoji"><noscript>' . esc_html__('The typing test needs JavaScript.', 'typing-test') . '</noscript></div>';
});

add_action('template_redirect', function () {
    global $post;
    if (!$post || !has_shortcode($post->post_content ?? '', 'typing_test')) return;
    // Logged-in pages carry a nonce; make sure they are never served from a page cache.
    if (is_user_logged_in()) nocache_headers();
    // WordPress's emoji script swaps emoji for images inside the app, which fights with the app's own rendering.
    remove_action('wp_head', 'print_emoji_detection_script', 7);
    remove_action('wp_print_styles', 'print_emoji_styles');
    remove_action('wp_enqueue_scripts', 'wp_enqueue_emoji_styles');
});
