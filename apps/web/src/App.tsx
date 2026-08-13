import { Navigate, Route, Routes } from 'react-router-dom';
import AboutPage from './pages/AboutPage';
import DailyWordPage from './pages/DailyWordPage';
import HomePage from './pages/HomePage';
import JoinPage from './pages/JoinPage';
import RoomPage from './pages/RoomPage';
import SettingsPage from './pages/SettingsPage';
import OnlinePage from './pages/OnlinePage';
import { FeatureUsageRouteTracker } from './components/FeatureUsageRouteTracker';

export default function App(): JSX.Element {
  const isGameDeployment = import.meta.env.VITE_APP_MODE === 'game';

  return (
    <>
      <FeatureUsageRouteTracker />
      <Routes>
        <Route path="/" element={isGameDeployment ? <Navigate to="/online" replace /> : <HomePage />} />
        <Route path="/play" element={<Navigate to="/online" replace />} />
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
