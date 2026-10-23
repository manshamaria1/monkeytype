<?php
/**
 * PHP port of verifySubmission() from shared/results.ts: re-runs a submitted test from
 * its keystroke log and decides whether it is valid and leaderboard-eligible.
 */

defined('ABSPATH') || defined('TT_TESTING') || exit;

const TT_RESULT_MODES = ['time', 'words', 'quote', 'custom', 'practice', 'lesson', 'challenge'];
const TT_TOLERANCE = 0.5;

function tt_data(): array {
    static $data = null;
    if ($data === null) {
        $data = json_decode(file_get_contents(__DIR__ . '/../data/data.json'), true);
    }
    return $data;
}

function tt_is_language(string $id): bool {
    return isset(tt_data()['languages'][$id]);
}

/** Validate the shape of a submission (the zod schema in shared/results.ts). Returns [sub, error]. */
function tt_parse_submission($raw): array {
    if (!is_array($raw)) return [null, 'Invalid request'];
    $str = fn($k, $max) => isset($raw[$k]) && is_string($raw[$k]) && $raw[$k] !== '' && mb_strlen($raw[$k]) <= $max;
    $bool = fn($k) => isset($raw[$k]) && is_bool($raw[$k]);
    if (!$str('clientId', 36) || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $raw['clientId'])) return [null, 'clientId: Invalid UUID'];
    if (!$str('mode', 20) || !in_array($raw['mode'], TT_RESULT_MODES, true)) return [null, 'mode: Invalid option'];
    if (!$str('mode2', 40)) return [null, 'mode2: Invalid'];
    if (!$str('language', 40)) return [null, 'language: Invalid'];
    if (!in_array($raw['wordListSize'] ?? null, ['small', 'medium', 'full'], true)) return [null, 'wordListSize: Invalid option'];
    foreach (['punctuation', 'numbers', 'strictMode', 'freedomMode', 'pasted'] as $k) if (!$bool($k)) return [null, "$k: Expected boolean"];
    if (!in_array($raw['difficulty'] ?? null, ['normal', 'expert', 'master'], true)) return [null, 'difficulty: Invalid option'];
    if (!in_array($raw['confidenceMode'] ?? null, ['off', 'on', 'max'], true)) return [null, 'confidenceMode: Invalid option'];
    $words = $raw['words'] ?? null;
    if (!is_array($words) || count($words) < 1 || count($words) > 5000) return [null, 'words: Invalid'];
    foreach ($words as $w) if (!is_string($w) || $w === '' || mb_strlen($w) > 80) return [null, 'words: Invalid word'];
    $events = $raw['events'] ?? null;
    if (!is_array($events) || count($events) < 1 || count($events) > 40000) return [null, 'events: Invalid'];
    foreach ($events as $ev) {
        if (!is_array($ev) || !isset($ev['t']) || !(is_int($ev['t']) || is_float($ev['t'])) || $ev['t'] < 0 || $ev['t'] > 3700000) return [null, 'events: Invalid event'];
        $k = $ev['k'] ?? null;
        if ($k === 'i') {
            if (!isset($ev['v']) || !is_string($ev['v']) || mb_strlen($ev['v']) > 120) return [null, 'events: Invalid event'];
        } elseif ($k !== 'c' && $k !== 'b') {
            return [null, 'events: Invalid event'];
        }
    }
    $d = $raw['durationMs'] ?? null;
    if (!is_int($d) || $d < 1 || $d > 3600000) return [null, 'durationMs: Invalid'];
    $c = $raw['claimed'] ?? null;
    if (!is_array($c)) return [null, 'claimed: Invalid'];
    foreach (['wpm', 'rawWpm', 'accuracy'] as $k) if (!isset($c[$k]) || !(is_int($c[$k]) || is_float($c[$k]))) return [null, "claimed.$k: Expected number"];
    if (isset($raw['finishedAt']) && !is_int($raw['finishedAt'])) return [null, 'finishedAt: Expected integer'];
    return [$raw, null];
}

function tt_rules_for(array $sub): array {
    return [
        'strict' => $sub['strictMode'],
        'confidence' => $sub['confidenceMode'],
        'freedom' => $sub['freedomMode'],
        'difficulty' => $sub['difficulty'],
        'bounded' => !($sub['mode'] === 'time' || $sub['mode'] === 'practice'),
    ];
}

function tt_split_text(string $text): array {
    $n = class_exists('Normalizer') ? Normalizer::normalize($text, Normalizer::FORM_C) : $text;
    return array_values(array_filter(preg_split('/\s+/u', $n ?: $text), fn($w) => $w !== ''));
}

function tt_lcfirst_mb(string $s): string {
    if ($s === '') return $s;
    return mb_strtolower(mb_substr($s, 0, 1)) . mb_substr($s, 1);
}

/** Mirror of isValidGeneratedWord() in shared/words.ts. */
function tt_is_valid_generated_word(string $word, string $language, bool $punctuation, bool $numbers): bool {
    $lang = tt_data()['languages'][$language] ?? null;
    if (!$lang) return false;
    static $sets = [];
    $set = $sets[$language] ??= array_flip($lang['words']);
    $core = class_exists('Normalizer') ? (Normalizer::normalize($word, Normalizer::FORM_C) ?: $word) : $word;
    if ($punctuation) {
        $core = preg_replace('/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/u', '', $core);
    } elseif (preg_match('/\p{P}/u', $core) && !isset($set[$core])) {
        return false;
    }
    if ($numbers && preg_match('/^[0-9]{1,4}$/', $core)) return true;
    if (isset($set[$core])) return true;
    if ($punctuation && $lang['hasCase']) return isset($set[tt_lcfirst_mb($core)]);
    return false;
}

/** Scripted input has almost perfectly regular keystroke intervals. */
function tt_looks_automated(array $events): bool {
    $n = count($events);
    if ($n < 30) return false;
    $deltas = [];
    for ($i = 1; $i < $n; $i++) $deltas[] = $events[$i]['t'] - $events[$i - 1]['t'];
    $mean = array_sum($deltas) / count($deltas);
    $var = 0.0;
    foreach ($deltas as $d) $var += ($d - $mean) ** 2;
    return sqrt($var / count($deltas)) < 3;
}

/**
 * Returns ['ok' => true, 'result' => [...]] or ['ok' => false, 'error' => string].
 */
function tt_verify_submission(array $sub): array {
    $data = tt_data();
    if (!tt_is_language($sub['language'])) return ['ok' => false, 'error' => 'Unknown language'];

    $prev = 0;
    foreach ($sub['events'] as $ev) {
        if ($ev['t'] < $prev) return ['ok' => false, 'error' => 'Keystroke log is out of order'];
        if ($ev['t'] > $sub['durationMs'] + 5) return ['ok' => false, 'error' => 'Keystroke after the end of the test'];
        $prev = $ev['t'];
    }

    $mode = $sub['mode'];
    $n = is_numeric($sub['mode2']) ? (float) $sub['mode2'] : NAN;
    $is_int = is_finite($n) && floor($n) == $n;
    $words = $sub['words'];
    switch ($mode) {
        case 'time':
            if (!$is_int || $n < 5 || $n > 3600) return ['ok' => false, 'error' => 'Invalid duration'];
            break;
        case 'words':
            if (!$is_int || $n < 1 || $n > 1000) return ['ok' => false, 'error' => 'Invalid word count'];
            if (count($words) !== (int) $n) return ['ok' => false, 'error' => 'Word count does not match the test'];
            break;
        case 'quote':
            $found = null;
            foreach ($data['languages'] as $lid => $l) {
                if (isset($l['quotes'][$sub['mode2']])) $found = [$lid, $l['quotes'][$sub['mode2']]];
            }
            if (!$found) return ['ok' => false, 'error' => 'Unknown quote'];
            if ($found[0] !== $sub['language']) return ['ok' => false, 'error' => 'Quote language mismatch'];
            if (implode(' ', tt_split_text($found[1])) !== implode(' ', $words)) return ['ok' => false, 'error' => 'Quote text does not match'];
            break;
        case 'lesson':
            if (!isset($data['lessons'][$sub['mode2']])) return ['ok' => false, 'error' => 'Unknown lesson'];
            break;
        case 'challenge':
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $sub['mode2'])) return ['ok' => false, 'error' => 'Invalid challenge date'];
            // Challenge text is generated from the date in the browser; here every word must be a valid
            // English word (punctuation and numbers allowed). Challenges are never ranked.
            foreach ($words as $w) {
                if (!tt_is_valid_generated_word($w, 'english', true, true)) return ['ok' => false, 'error' => 'Challenge text does not match'];
            }
            break;
    }

    if ($mode === 'time' || $mode === 'words') {
        $size = $data['wordListSizes'][$sub['wordListSize']];
        $pool = array_slice($data['languages'][$sub['language']]['words'], 0, $size);
        $allowed = array_flip($pool);
        foreach ($words as $w) {
            if (!tt_is_valid_generated_word($w, $sub['language'], $sub['punctuation'], $sub['numbers'])) {
                return ['ok' => false, 'error' => "Word not from the {$sub['language']} word list"];
            }
            $core = preg_replace('/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/u', '', $w);
            if (!preg_match('/^[0-9]+$/', $core) && !isset($allowed[$core]) && !isset($allowed[tt_lcfirst_mb($core)])) {
                return ['ok' => false, 'error' => 'Word not from the selected word list size'];
            }
        }
    }

    $rules = tt_rules_for($sub);
    if ($rules['bounded']) {
        $engine = tt_replay($words, $sub['events'], $rules);
        if (!$engine->finished) return ['ok' => false, 'error' => 'Test was not completed'];
        if (abs(($engine->end_t ?? 0) - $sub['durationMs']) > 5) return ['ok' => false, 'error' => 'Duration does not match the keystroke log'];
    } else {
        $engine = tt_replay($words, $sub['events'], $rules, (float) $sub['durationMs']);
        if ($mode === 'time' && abs($sub['durationMs'] - $n * 1000) > 50 && !$engine->failed) {
            return ['ok' => false, 'error' => 'Duration does not match the selected time'];
        }
    }

    $stats = $engine->stats();
    if ($stats['correctKeys'] + $stats['incorrectKeys'] === 0) return ['ok' => false, 'error' => 'No input recorded'];
    $c = $sub['claimed'];
    if (abs($stats['wpm'] - $c['wpm']) > TT_TOLERANCE || abs($stats['accuracy'] - $c['accuracy']) > TT_TOLERANCE || abs($stats['rawWpm'] - $c['rawWpm']) > TT_TOLERANCE) {
        return ['ok' => false, 'error' => 'Result does not match the keystroke log'];
    }
    if ($stats['wpm'] > 1000) return ['ok' => false, 'error' => 'Implausible speed'];

    $lb = $data['leaderboard'];
    $reasons = [];
    $is_time = $mode === 'time' && $is_int && in_array((int) $n, $lb['timeModes'], true);
    $is_words = $mode === 'words' && $is_int && in_array((int) $n, $lb['wordModes'], true);
    if (!$is_time && !$is_words) $reasons[] = 'Only standard time and word tests are ranked';
    if ($sub['punctuation'] || $sub['numbers']) $reasons[] = 'Punctuation and numbers must be off';
    if ($sub['wordListSize'] !== $lb['wordListSize']) $reasons[] = 'Only the default word list size is ranked';
    if ($engine->failed) $reasons[] = 'Failed tests are not ranked';
    if ($stats['accuracy'] < $lb['minAccuracy']) $reasons[] = "Accuracy below {$lb['minAccuracy']}%";
    if ($sub['pasted']) $reasons[] = 'Text was pasted';
    if ($stats['wpm'] > $lb['maxWpm']) $reasons[] = 'Speed above the plausibility limit';
    if (tt_looks_automated($sub['events'])) $reasons[] = 'Keystroke timing looks automated';

    return [
        'ok' => true,
        'result' => [
            'stats' => $stats,
            'timeline' => $engine->samples,
            'keyStats' => $engine->key_stats,
            'failed' => $engine->failed,
            'eligible' => count($reasons) === 0,
            'ineligibleReasons' => $reasons,
        ],
    ];
}
