# WordPress plugin

`wordpress/typing-test/` is a WordPress plugin that runs the complete app inside a WordPress site,
with no Node server: typing tests, accounts (WordPress users), statistics, leaderboards,
multiplayer races, lessons and achievements.

## For site owners

1. Plugins → Add New → Upload Plugin → `typing-test.zip` → Install → Activate.
2. Settings → General → tick **Anyone can register** (so visitors can create accounts).
3. Pages → Add New → add a **Shortcode** block with `[typing_test]` → Publish.
   `[typing_test view="test"]` shows only the typing test.
4. Settings → Typing Test shows a requirements check and lets admins delete suspicious ranked results.

Requirements: WordPress 6.4+, PHP 8.0+, MySQL 8.0+ or MariaDB 10.2+ (leaderboards use window functions).

## How it differs from the Node version

| | Node app | WordPress plugin |
| --- | --- | --- |
| Accounts | own users table, scrypt, sessions | WordPress users and login (cookie + `wp_rest` nonce) |
| Result checking | `shared/results.ts` | `includes/verify.php` + `includes/engine.php` (PHP port, same rules) |
| Database | PostgreSQL | WordPress database, `wp_tt_*` tables (see `includes/db.php`) |
| Multiplayer | WebSockets, rooms in memory | HTTP polling (~0.4 s during a race), rooms in `wp_tt_rooms` / `wp_tt_room_players`, per-room MySQL lock |
| Routing | `/leaderboard` paths | `#/leaderboard` inside the shortcode page |
| Account deletion | in-app | WordPress; "delete my typing data" in-app; WordPress privacy export/erase tools supported |

The browser app is the same code built with `vite build --mode wordpress` (`VITE_WP=1`):
`src/lib/wp.ts` maps `/api/...` calls to `/wp-json/typing-test/v1/...`, CSS is scoped to
`.tt-root` with rem converted to px (`scripts/build-wp.mjs`), and the theme tokens are set on
the plugin container, so the theme's styles are not affected.

Keystroke batches in multiplayer carry their position in the player's log (`from`), so a retried
request never applies events twice.

## Building

```bash
npm run build:wp      # -> wordpress/typing-test/assets/* and dist/typing-test.zip
```

This also regenerates `wordpress/typing-test/data/data.json` (word lists, quotes, lessons,
achievements, leaderboard rules) from `shared/`, so PHP checks results against the same data.

## Tests

- **Engine parity** (PHP vs TypeScript on 400 random sessions, including verification decisions):
  `npm run test:wp-parity`
- **REST API integration** against a running WordPress (skipped when none is reachable):
  `npx vitest run tests/wp` with `WP_URL` (default `http://localhost:8080`) and `WP_PAGE`
  (a page containing `[typing_test]`, default `/?page_id=5`), and users `alice`/`alicepass123`
  and `bob`/`bobpass12345`.
- Browser checks used during development: `scripts/dev/wp-check.mjs` and `scripts/dev/wp-race.mjs`.

Local WordPress used for testing (MariaDB + PHP built-in server):

```bash
mysql -e "CREATE DATABASE wp; CREATE USER 'wp'@'localhost' IDENTIFIED BY 'wp'; GRANT ALL ON wp.* TO 'wp'@'localhost';"
git clone --depth 1 --branch 7.1.3 https://github.com/WordPress/WordPress wp-test && cd wp-test
wp config create --dbname=wp --dbuser=wp --dbpass=wp --dbhost=127.0.0.1 --skip-check
wp core install --url=http://localhost:8080 --title="Typing Site" --admin_user=admin --admin_password=admin12345 --admin_email=admin@example.com --skip-email
unzip ../monkeytype/dist/typing-test.zip -d wp-content/plugins && wp plugin activate typing-test
wp post create --post_type=page --post_title="Typing Test" --post_status=publish --post_content='[typing_test]'
wp user create alice alice@example.com --user_pass=alicepass123 --display_name=Alice
wp user create bob bob@example.com --user_pass=bobpass12345 --display_name=Bob
php -S 0.0.0.0:8080
```

## Limits

- Multiplayer on shared hosting polls the server about 2–3 times per second per player during a
  race. That is fine for small rooms and normal traffic; very busy sites should use a host with a
  persistent object cache, or the Node version with WebSockets.
- Rate limits use transients (per user or IP).
- The emoji script of WordPress is turned off on the page with the shortcode (it rewrote the app's emoji into images).
