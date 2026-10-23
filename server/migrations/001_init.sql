-- Monkeytype initial schema. See docs/SCHEMA.md for a description of each table.

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT username_format CHECK (username ~ '^[A-Za-z0-9_]{3,20}$')
);
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));
CREATE UNIQUE INDEX users_username_lower ON users (lower(username));

CREATE TABLE profiles (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio        TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 300),
  avatar     TEXT NOT NULL DEFAULT 'monkey',
  country    CHAR(2),
  keyboard   TEXT NOT NULL DEFAULT '' CHECK (length(keyboard) <= 60),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,           -- sha256 of the cookie token, never the token itself
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('verify', 'reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user ON email_tokens (user_id, kind);

CREATE TABLE preferences (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  config     JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per completed test. Numbers are the server's replayed values.
CREATE TABLE test_results (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL,
  mode             TEXT NOT NULL,
  mode2            TEXT NOT NULL,
  language         TEXT NOT NULL,
  word_list_size   TEXT NOT NULL,
  punctuation      BOOLEAN NOT NULL,
  numbers          BOOLEAN NOT NULL,
  difficulty       TEXT NOT NULL,
  strict_mode      BOOLEAN NOT NULL,
  wpm              NUMERIC(7,2) NOT NULL CHECK (wpm >= 0),
  raw_wpm          NUMERIC(7,2) NOT NULL CHECK (raw_wpm >= 0),
  accuracy         NUMERIC(5,2) NOT NULL CHECK (accuracy BETWEEN 0 AND 100),
  consistency      NUMERIC(5,2) NOT NULL CHECK (consistency BETWEEN 0 AND 100),
  correct_chars    INT NOT NULL,
  incorrect_chars  INT NOT NULL,
  extra_chars      INT NOT NULL,
  missed_chars     INT NOT NULL,
  errors           INT NOT NULL,
  backspaces       INT NOT NULL,
  correct_words    INT NOT NULL,
  duration_ms      INT NOT NULL CHECK (duration_ms > 0),
  timeline         JSONB NOT NULL,
  key_stats        JSONB NOT NULL,
  failed           BOOLEAN NOT NULL DEFAULT false,
  leaderboard_eligible BOOLEAN NOT NULL DEFAULT false,
  ineligible_reasons TEXT[] NOT NULL DEFAULT '{}',
  is_pb            BOOLEAN NOT NULL DEFAULT false,
  imported         BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);
CREATE INDEX results_user_time ON test_results (user_id, created_at DESC);
CREATE INDEX results_leaderboard ON test_results (mode, mode2, language, created_at)
  WHERE leaderboard_eligible;
CREATE INDEX results_leaderboard_wpm ON test_results (mode, mode2, language, wpm DESC, accuracy DESC)
  WHERE leaderboard_eligible;

-- Raw keystroke logs for ranked results, kept so suspicious scores can be audited.
CREATE TABLE test_replays (
  result_id BIGINT PRIMARY KEY REFERENCES test_results(id) ON DELETE CASCADE,
  words     JSONB NOT NULL,
  events    JSONB NOT NULL
);

-- Best result per user and test configuration.
CREATE TABLE personal_records (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL,
  mode2       TEXT NOT NULL,
  language    TEXT NOT NULL,
  punctuation BOOLEAN NOT NULL,
  numbers     BOOLEAN NOT NULL,
  result_id   BIGINT NOT NULL REFERENCES test_results(id) ON DELETE CASCADE,
  wpm         NUMERIC(7,2) NOT NULL,
  accuracy    NUMERIC(5,2) NOT NULL,
  raw_wpm     NUMERIC(7,2) NOT NULL,
  consistency NUMERIC(5,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, mode, mode2, language, punctuation, numbers)
);

CREATE TABLE user_achievements (
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);

CREATE TABLE lesson_progress (
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id     TEXT NOT NULL,
  attempts      INT NOT NULL DEFAULT 0,
  best_wpm      NUMERIC(7,2) NOT NULL DEFAULT 0,
  best_accuracy NUMERIC(5,2) NOT NULL DEFAULT 0,
  completed_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE goals (
  user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  daily_tests  INT NOT NULL DEFAULT 5 CHECK (daily_tests BETWEEN 0 AND 500),
  daily_minutes INT NOT NULL DEFAULT 10 CHECK (daily_minutes BETWEEN 0 AND 600),
  target_wpm   INT NOT NULL DEFAULT 60 CHECK (target_wpm BETWEEN 0 AND 400),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Multiplayer. Live room state is held by the server process; these tables store history.
CREATE TABLE rooms (
  id           BIGSERIAL PRIMARY KEY,
  code         TEXT NOT NULL,
  host_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  settings     JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at    TIMESTAMPTZ
);
CREATE INDEX rooms_code ON rooms (code);

CREATE TABLE matches (
  id         BIGSERIAL PRIMARY KEY,
  room_id    BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  language   TEXT NOT NULL,
  words      JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ NOT NULL,
  end_reason TEXT NOT NULL
);

CREATE TABLE match_participants (
  match_id   BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat       INT NOT NULL,
  user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  guest_name TEXT,
  place      INT NOT NULL,
  outcome    TEXT NOT NULL CHECK (outcome IN ('win', 'loss', 'draw', 'dnf')),
  finished   BOOLEAN NOT NULL,
  finish_ms  INT,
  wpm        NUMERIC(7,2) NOT NULL,
  accuracy   NUMERIC(5,2) NOT NULL,
  progress   NUMERIC(5,4) NOT NULL,
  PRIMARY KEY (match_id, seat)
);
CREATE INDEX match_participants_user ON match_participants (user_id);
