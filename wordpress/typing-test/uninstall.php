<?php
// Runs when the plugin is deleted from Plugins → Installed Plugins: removes all its data.
defined('WP_UNINSTALL_PLUGIN') || exit;
global $wpdb;
foreach (['results', 'replays', 'records', 'achievements', 'lessons', 'goals', 'rooms', 'room_players', 'matches', 'match_players'] as $t) {
    $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}tt_{$t}");
}
$wpdb->query("DELETE FROM {$wpdb->usermeta} WHERE meta_key IN ('tt_config', 'tt_config_updated', 'tt_bio', 'tt_avatar', 'tt_country', 'tt_keyboard')");
delete_option('tt_db_version');
wp_clear_scheduled_hook('tt_cleanup');
