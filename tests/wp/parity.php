<?php
// Replays the TypeScript-generated sessions with the PHP engine and compares every number.
define('TT_TESTING', true);
require __DIR__ . '/../../wordpress/typing-test/includes/engine.php';
require __DIR__ . '/../../wordpress/typing-test/includes/verify.php';

$cases = json_decode(file_get_contents($argv[1]), true);
$fail = 0;
$checked = ['ok' => 0, 'rejected' => 0, 'eligible' => 0];
foreach ($cases as $i => $c) {
    $sub = $c['sub'];
    $exp = $c['expected'];
    [$parsed, $err] = tt_parse_submission($sub);
    if ($err) { echo "case $i: parse error $err\n"; $fail++; continue; }
    $rules = tt_rules_for($sub);
    $timed = !$rules['bounded'];
    $e = tt_replay($sub['words'], $sub['events'], $rules, $timed ? (float) $sub['durationMs'] : null);
    $s = $e->stats();
    foreach ($exp['stats'] as $k => $v) {
        if (abs($s[$k] - $v) > 1e-9) { echo "case $i: stats.$k php={$s[$k]} ts=$v\n"; $fail++; }
    }
    if (json_encode($e->samples) !== json_encode($exp['samples'])) { echo "case $i: samples differ\n"; $fail++; }
    $ks = $e->key_stats; ksort($ks); $eks = $exp['keyStats']; ksort($eks);
    if ($ks != $eks) { echo "case $i: keyStats differ\n"; $fail++; }
    if ($e->failed !== $exp['failed']) { echo "case $i: failed differs\n"; $fail++; }
    $v = tt_verify_submission($sub);
    $ev = $exp['verify'];
    if ($v['ok'] !== $ev['ok']) { echo "case $i: verify ok php=" . json_encode($v) . " ts=" . json_encode($ev) . "\n"; $fail++; continue; }
    if ($v['ok']) {
        $checked['ok']++;
        if ($v['result']['eligible']) $checked['eligible']++;
        if ($v['result']['ineligibleReasons'] !== $ev['reasons']) { echo "case $i: reasons php=" . json_encode($v['result']['ineligibleReasons']) . " ts=" . json_encode($ev['reasons']) . "\n"; $fail++; }
    } else {
        $checked['rejected']++;
        if ($v['error'] !== $ev['error']) { echo "case $i: error php={$v['error']} ts={$ev['error']}\n"; $fail++; }
    }
}
echo count($cases) . " cases, " . json_encode($checked) . ", mismatches: $fail\n";
exit($fail ? 1 : 0);
