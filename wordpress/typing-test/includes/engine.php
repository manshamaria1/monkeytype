<?php
/**
 * PHP port of shared/engine.ts. It must produce the same numbers as the browser,
 * because the server re-runs every submitted keystroke log to verify results.
 * tests/php/parity.php checks this against the TypeScript engine.
 */

defined('ABSPATH') || defined('TT_TESTING') || exit;

const TT_MAX_EXTRA = 20;

function tt_cps(string $s): array {
    if (class_exists('Normalizer')) {
        $n = Normalizer::normalize($s, Normalizer::FORM_C);
        if ($n !== false) $s = $n;
    }
    if ($s === '') return [];
    return mb_str_split($s, 1, 'UTF-8');
}

/** JavaScript's Math.round(n * 100) / 100 for the values we use (never negative). */
function tt_round2(float $n): float {
    return floor($n * 100 + 0.5) / 100;
}

function tt_wpm_from($chars, $ms): float {
    if (!($ms > 0) || !($chars > 0)) return 0.0;
    return $chars / 5 / ($ms / 60000);
}

function tt_consistency(array $values): float {
    $n = count($values);
    if ($n < 2) return 0.0;
    $mean = array_sum($values) / $n;
    if ($mean <= 0) return 0.0;
    $var = 0.0;
    foreach ($values as $v) $var += ($v - $mean) ** 2;
    $var /= $n;
    $cv = sqrt($var) / $mean;
    $v = 100 * (1 - tanh($cv + $cv ** 3 / 3 + $cv ** 5 / 5));
    return max(0.0, min(100.0, $v));
}

class TT_Engine {
    public array $rules;
    public array $words = [];
    public array $typed = [];
    public array $committed = [];
    public int $index = 0;
    public int $correct_keys = 0;
    public int $incorrect_keys = 0;
    public int $backspaces = 0;
    public array $key_stats = [];
    public array $keys_per_second = [];
    public array $errors_per_second = [];
    public array $samples = [];
    public float $last_t = 0;
    public bool $started = false;
    public bool $finished = false;
    public bool $failed = false;
    public ?float $end_t = null;

    public function __construct(array $words, array $rules = []) {
        $this->rules = array_merge(['strict' => false, 'confidence' => 'off', 'freedom' => false, 'difficulty' => 'normal', 'bounded' => true], $rules);
        foreach ($words as $w) {
            $this->words[] = tt_cps((string) $w);
            $this->typed[] = [];
            $this->committed[] = false;
        }
    }

    public function current_typed(): string {
        return implode('', $this->typed[$this->index] ?? []);
    }

    public function apply(array $ev): bool {
        if ($this->finished) return false;
        $t = $ev['t'] ?? null;
        if (!is_int($t) && !is_float($t)) return false;
        if (!is_finite((float) $t)) return false;
        $t = max((float) $t, $this->last_t, 0.0);
        $this->sample_until($t);
        $this->last_t = $t;
        $this->started = true;
        switch ($ev['k'] ?? '') {
            case 'i':
                $this->input(is_string($ev['v'] ?? null) ? $ev['v'] : '', $t);
                return true;
            case 'c':
                $this->commit($t);
                return true;
            case 'b':
                $this->back();
                return true;
        }
        return false;
    }

    private function bucket(float $t): int {
        $b = (int) floor($t / 1000);
        while (count($this->keys_per_second) <= $b) {
            $this->keys_per_second[] = 0;
            $this->errors_per_second[] = 0;
        }
        return $b;
    }

    private function count_key(float $t, ?string $target, bool $correct): void {
        $b = $this->bucket($t);
        $this->keys_per_second[$b]++;
        $key = $target ?? 'extra';
        if (!isset($this->key_stats[$key])) $this->key_stats[$key] = ['hit' => 0, 'miss' => 0];
        if ($correct) {
            $this->correct_keys++;
            $this->key_stats[$key]['hit']++;
        } else {
            $this->incorrect_keys++;
            $this->errors_per_second[$b]++;
            $this->key_stats[$key]['miss']++;
        }
    }

    private function input(string $value, float $t): void {
        if (strpos($value, ' ') !== false) $value = str_replace(' ', '', $value);
        if (!isset($this->words[$this->index])) return;
        $target = $this->words[$this->index];
        $prev = $this->typed[$this->index];
        $next = tt_cps($value);
        $p = 0;
        $pl = count($prev);
        $nl = count($next);
        while ($p < $pl && $p < $nl && $prev[$p] === $next[$p]) $p++;
        $removed = $pl - $p;
        if ($removed > 0 && $this->rules['confidence'] === 'max') return;
        if ($removed > 0) $this->backspaces += $removed;
        $accepted = array_slice($prev, 0, $p);
        $tl = count($target);
        for ($i = $p; $i < $nl; $i++) {
            if (count($accepted) >= $tl + TT_MAX_EXTRA) break;
            $ch = $next[$i];
            $want = $target[count($accepted)] ?? null;
            $ok = $ch === $want;
            $this->count_key($t, $want, $ok);
            if (!$ok) {
                if ($this->rules['difficulty'] === 'master') {
                    $accepted[] = $ch;
                    $this->typed[$this->index] = $accepted;
                    $this->fail($t);
                    return;
                }
                if ($this->rules['strict']) break;
            }
            $accepted[] = $ch;
        }
        $this->typed[$this->index] = $accepted;
        if ($this->rules['bounded'] && $this->index === count($this->words) - 1 && count($accepted) === $tl && $accepted === $target) {
            $this->finish_at($t);
        }
    }

    private function commit(float $t): void {
        $typed = $this->typed[$this->index];
        $target = $this->words[$this->index] ?? null;
        if ($target === null || count($typed) === 0) return;
        $correct = $typed === $target;
        if (!$correct && $this->rules['strict']) {
            $this->count_key($t, ' ', false);
            return;
        }
        $this->count_key($t, ' ', $correct);
        if (!$correct && $this->rules['difficulty'] !== 'normal') {
            $this->committed[$this->index] = true;
            $this->fail($t);
            return;
        }
        $this->committed[$this->index] = true;
        $this->index++;
        if ($this->rules['bounded'] && $this->index >= count($this->words)) {
            $this->index = count($this->words) - 1;
            $this->finish_at($t);
        }
    }

    public function can_go_back(): bool {
        if ($this->index === 0 || $this->rules['confidence'] !== 'off') return false;
        if ($this->rules['freedom']) return true;
        $prev = $this->index - 1;
        return $this->typed[$prev] !== $this->words[$prev];
    }

    private function back(): void {
        if (count($this->typed[$this->index]) > 0 || !$this->can_go_back()) return;
        $this->index--;
        $this->committed[$this->index] = false;
        $this->backspaces++;
    }

    private function fail(float $t): void {
        $this->failed = true;
        $this->finish_at($t);
    }

    private function finish_at(float $t): void {
        if ($this->finished) return;
        $this->sample_until($t);
        $this->last_t = $t;
        $this->end_t = $t;
        $this->finished = true;
        $this->push_final_sample($t);
    }

    public function finish(float $t): void {
        if ($this->finished) return;
        $this->finish_at(max($t, $this->last_t, 0.0));
    }

    private function sample_until(float $t): void {
        while ((count($this->samples) + 1) * 1000 <= $t) {
            $s = count($this->samples) + 1;
            $this->samples[] = $this->make_sample($s, $s * 1000, 1000);
        }
    }

    private function push_final_sample(float $t): void {
        $done = count($this->samples) * 1000;
        $rest = $t - $done;
        if ($rest >= 250 || count($this->samples) === 0) {
            $this->samples[] = $this->make_sample(count($this->samples) + 1, $t, max($rest, 1));
        }
    }

    private function make_sample(int $s, float $at_ms, float $span_ms): array {
        $keys = $this->keys_per_second[$s - 1] ?? 0;
        $err = $this->errors_per_second[$s - 1] ?? 0;
        return [
            's' => $s,
            'wpm' => tt_round2(tt_wpm_from($this->count_chars()['correct'], $at_ms)),
            'raw' => tt_round2(tt_wpm_from($keys, $span_ms)),
            'err' => $err,
        ];
    }

    public function count_chars(): array {
        $correct = $incorrect = $extra = $missed = $raw = $correct_words = 0;
        $last = $this->index;
        $wc = count($this->words);
        for ($i = 0; $i <= $last && $i < $wc; $i++) {
            $target = $this->words[$i];
            $typed = $this->typed[$i];
            $tl = count($target);
            $yl = count($typed);
            if (!$this->committed[$i] && $i === $last) {
                $prefix_ok = true;
                for ($j = 0; $j < $yl; $j++) {
                    $want = $target[$j] ?? null;
                    if ($j >= $tl) $extra++;
                    elseif ($typed[$j] !== $want) $incorrect++;
                    if ($typed[$j] !== $want) $prefix_ok = false;
                }
                $raw += $yl;
                if ($prefix_ok) $correct += $yl;
                if ($prefix_ok && $yl === $tl) $correct_words++;
                continue;
            }
            $raw += $yl + 1;
            if ($typed === $target) {
                $correct += $tl + 1;
                $correct_words++;
            } else {
                $max = max($yl, $tl);
                for ($j = 0; $j < $max; $j++) {
                    if ($j >= $tl) $extra++;
                    elseif ($j >= $yl) $missed++;
                    elseif ($typed[$j] !== $target[$j]) $incorrect++;
                }
            }
        }
        return compact('correct', 'incorrect', 'extra', 'missed', 'raw') + ['correctWords' => $correct_words];
    }

    public function stats(?float $t = null): array {
        $at = $this->end_t ?? max($t ?? $this->last_t, 0.0);
        $c = $this->count_chars();
        $keys = $this->correct_keys + $this->incorrect_keys;
        $committed = count(array_filter($this->committed));
        $last_done = $this->finished && !$this->failed && !($this->committed[$this->index] ?? false) ? 1 : 0;
        return [
            'wpm' => tt_round2(tt_wpm_from($c['correct'], $at)),
            'rawWpm' => tt_round2(tt_wpm_from($c['raw'], $at)),
            'accuracy' => $keys === 0 ? 0.0 : tt_round2($this->correct_keys / $keys * 100),
            'consistency' => tt_round2(tt_consistency(array_map(fn($s) => $s['raw'], $this->samples))),
            'correctChars' => $c['correct'],
            'incorrectChars' => $c['incorrect'],
            'extraChars' => $c['extra'],
            'missedChars' => $c['missed'],
            'correctKeys' => $this->correct_keys,
            'incorrectKeys' => $this->incorrect_keys,
            'backspaces' => $this->backspaces,
            'durationMs' => (int) round($at),
            'wordsCompleted' => $committed + $last_done,
            'correctWords' => $c['correctWords'],
        ];
    }

    public function progress(): float {
        if ($this->finished && !$this->failed) return 1.0;
        $total = count($this->words);
        if ($total === 0) return 0.0;
        $target = $this->words[$this->index] ?? [];
        $partial = count($target) ? min(count($this->typed[$this->index]) / count($target), 1) : 0;
        return min(($this->index + $partial) / $total, 1.0);
    }
}

/** Replay a complete event log (mirror of replay() in shared/engine.ts). */
function tt_replay(array $words, array $events, array $rules, ?float $end_t = null): TT_Engine {
    $e = new TT_Engine($words, $rules);
    foreach ($events as $ev) {
        if ($e->finished) break;
        if ($end_t !== null && ($ev['t'] ?? 0) > $end_t) break;
        $e->apply($ev);
    }
    if ($end_t !== null) $e->finish($end_t);
    return $e;
}
