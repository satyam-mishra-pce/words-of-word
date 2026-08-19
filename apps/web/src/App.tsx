import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AboutPage from './pages/AboutPage';
import DailyWordPage from './pages/DailyWordPage';
import HomePage from './pages/HomePage';
import BrochurePage from './pages/BrochurePage';
import GameHomePage from './pages/GameHomePage';
import JoinPage from './pages/JoinPage';
import RoomPage from './pages/RoomPage';
import SettingsPage from './pages/SettingsPage';
import OnlinePage from './pages/OnlinePage';
import { FeatureUsageRouteTracker } from './components/FeatureUsageRouteTracker';
import { stopGameAudio, unlockGameAudio } from './services/gameAudio';
import { initAnalytics } from './services/analytics';

function PlayRedirect(): JSX.Element {
  useEffect(() => {
    window.location.replace('https://wordsofword.in/');
  }, []);

  return (
    <main className="page-shell">
      <section className="panel-card">
        <p className="eyebrow">redirecting</p>
        <h1>Opening Words of Word</h1>
        <p className="muted">Taking you to wordsofword.in…</p>
      </section>
    </main>
  );
}

export default function App(): JSX.Element {
  useEffect(() => {
    initAnalytics();
    const unlock = (): void => { void unlockGameAudio(); };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      stopGameAudio();
    };
  }, []);

  // The game is the default for local development and AWS. Vercel explicitly
  // sets this to "portfolio" for the separate marketing site, or "brochure"
  // for the external-link-free brochure site.
  const deploymentSurface = import.meta.env.VITE_DEPLOYMENT_SURFACE;
  const isBrochureDeployment = deploymentSurface === 'brochure';
  const isGameDeployment = deploymentSurface !== 'portfolio' && !isBrochureDeployment;

  function renderRootPage(): JSX.Element {
    if (isBrochureDeployment) return <BrochurePage />;
    return isGameDeployment ? <GameHomePage /> : <HomePage />;
  }

  return (
    <>
      <FeatureUsageRouteTracker />
      <Routes>
        <Route path="/" element={renderRootPage()} />
        <Route path="/play" element={<PlayRedirect />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/online" element={<OnlinePage />} />
        <Route path="/daily" element={<DailyWordPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/join/:roomId" element={<JoinPage />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
