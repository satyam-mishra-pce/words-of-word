import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AboutPage from './pages/AboutPage';
import DailyWordPage from './pages/DailyWordPage';
import HomePage from './pages/HomePage';
import GameHomePage from './pages/GameHomePage';
import JoinPage from './pages/JoinPage';
import RoomPage from './pages/RoomPage';
import SettingsPage from './pages/SettingsPage';
import OnlinePage from './pages/OnlinePage';
import { FeatureUsageRouteTracker } from './components/FeatureUsageRouteTracker';

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
  const isGameDeployment = import.meta.env.VITE_DEPLOYMENT_SURFACE === 'game';

  return (
    <>
      <FeatureUsageRouteTracker />
      <Routes>
        <Route path="/" element={isGameDeployment ? <GameHomePage /> : <HomePage />} />
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
