import { Navigate, Route, Routes } from 'react-router-dom';
import DailyWordPage from './pages/DailyWordPage';
import GameHomePage from './pages/GameHomePage';
import HomePage from './pages/HomePage';
import JoinPage from './pages/JoinPage';
import RoomPage from './pages/RoomPage';
import SettingsPage from './pages/SettingsPage';
import { ThemeToggle } from './components/ThemeToggle';

export default function App(): JSX.Element {
  return (
    <>
      <ThemeToggle />
      <Routes>
        <Route path="/" element={<GameHomePage />} />
        <Route path="/about" element={<HomePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/daily" element={<DailyWordPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/join/:roomId" element={<JoinPage />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
