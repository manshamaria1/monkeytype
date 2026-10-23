<?php
/**
 * Plugin Name:       Typing Test
 * Description:       A complete typing test for your site: speed tests, accounts (your WordPress users), personal statistics, leaderboards, multiplayer races, lessons and achievements. Add it to any page with the [typing_test] shortcode.
 * Version:           1.0.0
 * Requires at least: 6.4
 * Requires PHP:      8.0
 * Author:            Typing Test
 * License:           GPL-2.0-or-later
 * Text Domain:       typing-test
 */

defined('ABSPATH') || exit;

define('TT_VERSION', '1.0.0');
define('TT_DB_VERSION', '1');
define('TT_FILE', __FILE__);
define('TT_DIR', __DIR__);

require_once TT_DIR . '/includes/engine.php';
require_once TT_DIR . '/includes/verify.php';
require_once TT_DIR . '/includes/db.php';
require_once TT_DIR . '/includes/helpers.php';
require_once TT_DIR . '/includes/results.php';
require_once TT_DIR . '/includes/rest.php';
require_once TT_DIR . '/includes/multiplayer.php';
require_once TT_DIR . '/includes/privacy.php';
require_once TT_DIR . '/includes/admin.php';
require_once TT_DIR . '/includes/shortcode.php';

register_activation_hook(__FILE__, 'tt_activate');
register_deactivation_hook(__FILE__, function () {
    wp_clear_scheduled_hook('tt_cleanup');
});

function tt_activate() {
    tt_install_tables();
    if (!wp_next_scheduled('tt_cleanup')) wp_schedule_event(time() + 300, 'hourly', 'tt_cleanup');
}

// Upgrade tables when the plugin is updated without re-activation.
add_action('plugins_loaded', function () {
    if (get_option('tt_db_version') !== TT_DB_VERSION) tt_install_tables();
});

add_action('tt_cleanup', 'tt_mp_cleanup');
