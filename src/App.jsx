import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import LiveTV from './pages/LiveTV';
import VOD from './pages/VOD';
import Series from './pages/Series';
import SeriesDetail from './pages/SeriesDetail';
import Player from './pages/Player';
import Favorites from './pages/Favorites';
import Settings from './pages/Settings';
import Search from './pages/Search';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen bg-surface-900"><div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" /></div>;
  return user ? children : <Navigate to="/login" />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="live/:connId" element={<LiveTV />} />
        <Route path="vod/:connId" element={<VOD />} />
        <Route path="series/:connId" element={<Series />} />
        <Route path="series/:connId/:seriesId" element={<SeriesDetail />} />
        <Route path="player/:connId/:type/:streamId" element={<Player />} />
        <Route path="favorites" element={<Favorites />} />
        <Route path="search/:connId" element={<Search />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
