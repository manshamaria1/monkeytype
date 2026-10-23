<?php
defined('ABSPATH') || exit;

function tt_table(string $name): string {
    global $wpdb;
    return $wpdb->prefix . 'tt_' . $name;
}

/** Create or upgrade tables (dbDelta compares and alters). See docs/SCHEMA.md for the Node version. */
function tt_install_tables(): void {
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $c = $wpdb->get_charset_collate();
    $t = 'tt_table';
    $sql = [];
    // One row per completed test. Numbers are the server's own replayed values.
    $sql[] = "CREATE TABLE {$t('results')} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id bigint(20) unsigned NOT NULL,
  client_id char(36) NOT NULL,
  mode varchar(20) NOT NULL,
  mode2 varchar(40) NOT NULL,
  language varchar(40) NOT NULL,
  word_list_size varchar(10) NOT NULL,
  punctuation tinyint(1) NOT NULL DEFAULT 0,
  numbers tinyint(1) NOT NULL DEFAULT 0,
  difficulty varchar(10) NOT NULL,
  strict_mode tinyint(1) NOT NULL DEFAULT 0,
  wpm decimal(7,2) NOT NULL,
  raw_wpm decimal(7,2) NOT NULL,
  accuracy decimal(5,2) NOT NULL,
  consistency decimal(5,2) NOT NULL,
  correct_chars int(11) NOT NULL,
  incorrect_chars int(11) NOT NULL,
  extra_chars int(11) NOT NULL,
  missed_chars int(11) NOT NULL,
  errors int(11) NOT NULL,
  backspaces int(11) NOT NULL,
  correct_words int(11) NOT NULL,
  duration_ms int(11) NOT NULL,
  timeline longtext NOT NULL,
  key_stats longtext NOT NULL,
  failed tinyint(1) NOT NULL DEFAULT 0,
  leaderboard_eligible tinyint(1) NOT NULL DEFAULT 0,
  ineligible_reasons text NOT NULL,
  is_pb tinyint(1) NOT NULL DEFAULT 0,
  imported tinyint(1) NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY user_client (user_id,client_id),
  KEY user_time (user_id,created_at),
  KEY board (leaderboard_eligible,mode,mode2,language,created_at),
  KEY board_wpm (leaderboard_eligible,mode,mode2,language,wpm)
) $c;";
    // Keystroke logs of ranked results, for auditing suspicious scores.
    $sql[] = "CREATE TABLE {$t('replays')} (
  result_id bigint(20) unsigned NOT NULL,
  words longtext NOT NULL,
  events longtext NOT NULL,
  PRIMARY KEY  (result_id)
) $c;";
    $sql[] = "CREATE TABLE {$t('records')} (
  user_id bigint(20) unsigned NOT NULL,
  mode varchar(20) NOT NULL,
  mode2 varchar(40) NOT NULL,
  language varchar(40) NOT NULL,
  punctuation tinyint(1) NOT NULL,
  numbers tinyint(1) NOT NULL,
  result_id bigint(20) unsigned NOT NULL,
  wpm decimal(7,2) NOT NULL,
  accuracy decimal(5,2) NOT NULL,
  raw_wpm decimal(7,2) NOT NULL,
  consistency decimal(5,2) NOT NULL,
  created_at datetime NOT NULL,
  PRIMARY KEY  (user_id,mode,mode2,language,punctuation,numbers),
  KEY result_id (result_id)
) $c;";
    $sql[] = "CREATE TABLE {$t('achievements')} (
  user_id bigint(20) unsigned NOT NULL,
  achievement_id varchar(40) NOT NULL,
  unlocked_at datetime NOT NULL,
  PRIMARY KEY  (user_id,achievement_id)
) $c;";
    $sql[] = "CREATE TABLE {$t('lessons')} (
  user_id bigint(20) unsigned NOT NULL,
  lesson_id varchar(40) NOT NULL,
  attempts int(11) NOT NULL DEFAULT 0,
  best_wpm decimal(7,2) NOT NULL DEFAULT 0,
  best_accuracy decimal(5,2) NOT NULL DEFAULT 0,
  completed_at datetime DEFAULT NULL,
  updated_at datetime NOT NULL,
  PRIMARY KEY  (user_id,lesson_id)
) $c;";
    $sql[] = "CREATE TABLE {$t('goals')} (
  user_id bigint(20) unsigned NOT NULL,
  daily_tests int(11) NOT NULL DEFAULT 5,
  daily_minutes int(11) NOT NULL DEFAULT 10,
  target_wpm int(11) NOT NULL DEFAULT 60,
  PRIMARY KEY  (user_id)
) $c;";
    // Multiplayer: live room state is kept here (no long-running server on shared hosting).
    $sql[] = "CREATE TABLE {$t('rooms')} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  code char(5) NOT NULL,
  state varchar(12) NOT NULL,
  host_seat int(11) NOT NULL DEFAULT 0,
  settings text NOT NULL,
  words longtext NOT NULL,
  start_at bigint(20) DEFAULT NULL,
  ended_at bigint(20) DEFAULT NULL,
  end_reason varchar(20) DEFAULT NULL,
  next_seat int(11) NOT NULL DEFAULT 0,
  updated_at bigint(20) NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY code (code)
) $c;";
    $sql[] = "CREATE TABLE {$t('room_players')} (
  room_id bigint(20) unsigned NOT NULL,
  seat int(11) NOT NULL,
  user_id bigint(20) unsigned DEFAULT NULL,
  name varchar(60) NOT NULL,
  avatar varchar(20) NOT NULL,
  token char(32) NOT NULL,
  last_seen bigint(20) NOT NULL,
  ready tinyint(1) NOT NULL DEFAULT 0,
  events longtext NOT NULL,
  progress decimal(6,4) NOT NULL DEFAULT 0,
  wpm decimal(7,2) NOT NULL DEFAULT 0,
  accuracy decimal(5,2) NOT NULL DEFAULT 0,
  finish_ms int(11) DEFAULT NULL,
  dnf_reason varchar(20) DEFAULT NULL,
  place int(11) DEFAULT NULL,
  outcome varchar(5) DEFAULT NULL,
  PRIMARY KEY  (room_id,seat),
  KEY token (token)
) $c;";
    $sql[] = "CREATE TABLE {$t('matches')} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  room_code char(5) NOT NULL,
  language varchar(40) NOT NULL,
  words longtext NOT NULL,
  started_at datetime NOT NULL,
  ended_at datetime NOT NULL,
  end_reason varchar(20) NOT NULL,
  PRIMARY KEY  (id)
) $c;";
    $sql[] = "CREATE TABLE {$t('match_players')} (
  match_id bigint(20) unsigned NOT NULL,
  seat int(11) NOT NULL,
  user_id bigint(20) unsigned DEFAULT NULL,
  guest_name varchar(60) DEFAULT NULL,
  place int(11) NOT NULL,
  outcome varchar(5) NOT NULL,
  finished tinyint(1) NOT NULL,
  finish_ms int(11) DEFAULT NULL,
  wpm decimal(7,2) NOT NULL,
  accuracy decimal(5,2) NOT NULL,
  progress decimal(6,4) NOT NULL,
  PRIMARY KEY  (match_id,seat),
  KEY user_id (user_id)
) $c;";
    foreach ($sql as $q) dbDelta($q);
    update_option('tt_db_version', TT_DB_VERSION);
}

/** Every table, for uninstall and data erasure. */
function tt_all_tables(): array {
    return array_map('tt_table', ['results', 'replays', 'records', 'achievements', 'lessons', 'goals', 'rooms', 'room_players', 'matches', 'match_players']);
}
