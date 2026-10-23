import { Link } from "react-router-dom";
import { LANGUAGES } from "../../shared/languages";
import { useUi } from "../state/ui";
import { WP } from "../lib/wp";

export default function AboutPage() {
  const ui = useUi();
  return (
    <div className="page prose">
      <h1>{WP ? "About this typing test" : "About Monkeytype"}</h1>
      <p>
        {WP ? "This" : "Monkeytype"} is a minimal typing test. Pick a mode, start typing, and see your speed and accuracy. Create an account to keep your history, sync
        settings, appear on leaderboards, race other people and track your progress through lessons and achievements.
      </p>

      <h2 id="help">Getting started</h2>
      <ul>
        <li>The test starts on your first keystroke. Press space to move to the next word.</li>
        <li>
          Backspace fixes letters. On an empty word, backspace goes back to the previous word only if it has a mistake (turn on freedom mode in{" "}
          <Link to="/settings#settings-input">settings</Link> to go back to any word).
        </li>
        <li>
          Press <kbd>tab</kbd> to restart, <kbd>esc</kbd> for the command palette, and{" "}
          <button className="link-btn" onClick={() => ui.setShortcutsOpen(true)}>
            see all shortcuts
          </button>
          .
        </li>
      </ul>

      <h2 id="formulas">How results are calculated</h2>
      <p>The same code calculates results in your browser, on the server, in history, statistics and leaderboards.</p>
      <dl className="defs">
        <dt>WPM (net)</dt>
        <dd>
          Characters in correctly typed words, plus the spaces after them, divided by 5, divided by the test time in minutes. For the word you are
          typing when the test ends, correct letters so far count. A word with any mistake left in it counts as zero.
        </dd>
        <dt>Raw WPM (gross)</dt>
        <dd>All characters you typed (correct, wrong and extra letters plus spaces) ÷ 5 ÷ minutes. Raw is never lower than WPM.</dd>
        <dt>Accuracy</dt>
        <dd>
          Correct keystrokes ÷ all letter and space keystrokes × 100. A mistake you later fix with backspace still counts as a wrong keystroke.
          Backspaces themselves are not counted as keystrokes. Extra letters are wrong keystrokes. A space after a wrong word is a wrong keystroke.
        </dd>
        <dt>Consistency</dt>
        <dd>
          Based on how much your raw speed varies from second to second: with cv = standard deviation ÷ mean of the per-second raw speeds,
          consistency = 100 × (1 − tanh(cv + cv³/3 + cv⁵/5)). Steady typing scores close to 100%.
        </dd>
        <dt>Characters</dt>
        <dd>Shown as correct / incorrect / extra / missed characters in the final text.</dd>
        <dt>Errors</dt>
        <dd>The number of wrong keystrokes, including ones you corrected.</dd>
        <dt>Time</dt>
        <dd>
          Measured from your first keystroke using a high-resolution clock. Timed tests end exactly when the time runs out, even if the browser tab is in
          the background, so a slow tab can never stretch or shorten a test.
        </dd>
      </dl>

      <h2>Test modes and options</h2>
      <ul>
        <li>
          <strong>time</strong>: type as much as you can in 15, 30, 60, 120 seconds or a custom duration.
        </li>
        <li>
          <strong>words</strong>: type 10, 25, 50, 100 words or a custom count. The test ends when the last word is typed correctly, or when you press space after it.
        </li>
        <li>
          <strong>quote</strong>: type a passage (public-domain literature, proverbs or original text).
        </li>
        <li>
          <strong>custom</strong>: type any text you enter.
        </li>
        <li>
          <strong>practice</strong>: endless words with no timer. Press shift+enter or "finish practice" to see results.
        </li>
        <li>
          <strong>difficulty</strong>: normal; expert fails the test if you submit a wrong word; master fails it on any wrong key.
        </li>
        <li>
          <strong>strict mode</strong>: wrong letters are not entered, and space only works when the word is correct.
        </li>
      </ul>

      <h2>Languages</h2>
      <table className="table compact">
        <thead>
          <tr>
            <th>language</th>
            <th>direction</th>
            <th className="num">words</th>
            <th className="num">quotes</th>
            <th>status</th>
          </tr>
        </thead>
        <tbody>
          {LANGUAGES.map((l) => (
            <tr key={l.id}>
              <td>
                {l.name} <span className="muted">{l.nativeName}</span>
              </td>
              <td>{l.dir === "rtl" ? "right-to-left" : "left-to-right"}</td>
              <td className="num">{l.words.length}</td>
              <td className="num">{l.quotes.length}</td>
              <td>{l.status === "full" ? "supported" : "beta"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Beta languages pass the automated text, rendering and typing tests, but need a native keyboard layout or input method on your device and have had
        limited testing with real users. Text is compared character by character after Unicode normalisation (NFC), so composed and decomposed accents
        are treated the same.
      </p>

      <h2>Leaderboards and fair play</h2>
      <p>
        Every saved result is recalculated on the server from its keystroke log, so edited numbers are rejected. Leaderboards also apply plausibility
        checks. No automatic system can prove a human typed a result, so the leaderboard cannot be guaranteed cheat-free. See the rules on the{" "}
        <Link to="/leaderboard">leaderboard page</Link>.
      </p>

      {WP ? (
        <>
          <h2 id="privacy">Privacy</h2>
          <ul>
            <li>Without an account, settings and results stay in your browser's local storage.</li>
            <li>
              With a {WP.siteName} account, your typing results, records, progress, race history and typing settings are saved to that account. Your
              email and full history are never shown to other users; your profile, records and achievements are public.
            </li>
            <li>
              You can download or delete your typing data from your <Link to="/profile">profile</Link>.
              {WP.privacyUrl && (
                <>
                  {" "}
                  See the site's <a href={WP.privacyUrl}>privacy policy</a>.
                </>
              )}
            </li>
          </ul>
        </>
      ) : (
        <>
          <h2 id="privacy">Privacy</h2>
          <ul>
            <li>Without an account, settings and results stay in your browser's local storage.</li>
            <li>
              With an account we store your email, username, a scrypt hash of your password (never the password itself), your profile, settings, test results
              (including keystroke timings for ranked results, kept to audit leaderboard entries) and race history.
            </li>
            <li>Your email and full history are never shown to other users. Your profile, records and achievements are public.</li>
            <li>
              You can download all your data or delete your account permanently from your <Link to="/profile">profile</Link>. Deleting the account removes
              all of its data.
            </li>
            <li>Fonts are loaded from Google Fonts. No analytics or advertising trackers are used.</li>
          </ul>

        </>
      )}

      {!WP && (
        <>
      <h2>Credits</h2>
      <p className="muted">
        Inspired by the minimalist typing-test style popularised by the open-source Monkeytype project. This implementation, its themes and assets are
        original. Before any public launch, check your rights to the name and branding.
      </p>
        </>
      )}
    </div>
  );
}
