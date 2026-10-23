import { lazy, Suspense } from "react";
import { BrowserRouter, Link, MemoryRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { AuthProvider } from "./state/auth";
import { ConfigProvider } from "./state/config";
import { ToastProvider } from "./state/toast";
import { UiProvider } from "./state/ui";
import TestPage from "./pages/TestPage";

// The typing test loads first; other pages are split into separate chunks.
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage"));
const StatsPage = lazy(() => import("./pages/StatsPage"));
const ResultDetailPage = lazy(() => import("./pages/StatsPage").then((m) => ({ default: m.ResultDetailPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const MultiplayerPage = lazy(() => import("./pages/MultiplayerPage"));
const PracticePage = lazy(() => import("./pages/PracticePage"));
const LessonPage = lazy(() => import("./pages/PracticePage").then((m) => ({ default: m.LessonPage })));
const ChallengePage = lazy(() => import("./pages/PracticePage").then((m) => ({ default: m.ChallengePage })));
const WeakKeysPage = lazy(() => import("./pages/PracticePage").then((m) => ({ default: m.WeakKeysPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const PublicProfilePage = lazy(() => import("./pages/ProfilePage").then((m) => ({ default: m.PublicProfilePage })));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const Account = {
  Login: lazy(() => import("./pages/AccountPages").then((m) => ({ default: m.LoginPage }))),
  Register: lazy(() => import("./pages/AccountPages").then((m) => ({ default: m.RegisterPage }))),
  Forgot: lazy(() => import("./pages/AccountPages").then((m) => ({ default: m.ForgotPage }))),
  Reset: lazy(() => import("./pages/AccountPages").then((m) => ({ default: m.ResetPage }))),
  Verify: lazy(() => import("./pages/AccountPages").then((m) => ({ default: m.VerifyPage }))),
};

function NotFound() {
  return (
    <div className="page center">
      <h1>404</h1>
      <p>This page does not exist.</p>
      <Link className="btn" to="/">
        back to typing
      </Link>
    </div>
  );
}

/** Preview build: runs without a server, inside a frame whose URL it cannot control. */
export const PREVIEW = import.meta.env.VITE_PREVIEW === "1";
const Router = PREVIEW ? MemoryRouter : BrowserRouter;

export default function App() {
  return (
    <Router>
      <ToastProvider>
        <AuthProvider>
          <ConfigProvider>
            <UiProvider>
              <Suspense fallback={<div className="page muted">Loading…</div>}>
                <Routes>
                  <Route element={<Layout />}>
                    <Route index element={<TestPage />} />
                    <Route path="leaderboard" element={<LeaderboardPage />} />
                    <Route path="multiplayer" element={<MultiplayerPage />} />
                    <Route path="multiplayer/:code" element={<MultiplayerPage />} />
                    <Route path="stats" element={<StatsPage />} />
                    <Route path="stats/result/:id" element={<ResultDetailPage />} />
                    <Route path="practice" element={<PracticePage />} />
                    <Route path="practice/lesson/:id" element={<LessonPage />} />
                    <Route path="practice/challenge" element={<ChallengePage />} />
                    <Route path="practice/weak-keys" element={<WeakKeysPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="profile" element={<ProfilePage />} />
                    <Route path="u/:username" element={<PublicProfilePage />} />
                    <Route path="about" element={<AboutPage />} />
                    <Route path="account/login" element={<Account.Login />} />
                    <Route path="account/register" element={<Account.Register />} />
                    <Route path="account/forgot" element={<Account.Forgot />} />
                    <Route path="account/reset" element={<Account.Reset />} />
                    <Route path="account/verify" element={<Account.Verify />} />
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Routes>
              </Suspense>
            </UiProvider>
          </ConfigProvider>
        </AuthProvider>
      </ToastProvider>
    </Router>
  );
}
