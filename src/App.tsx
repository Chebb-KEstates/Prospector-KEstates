import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './state/AuthContext';
import { ThemeProvider } from './state/ThemeContext';
import { VaultProvider } from './state/VaultContext';
import { LoginScreen } from './components/LoginScreen';
import { ChangePasswordScreen } from './components/ChangePasswordScreen';
import { ManagerShell } from './components/manager/ManagerShell';
import { BrokerShell } from './components/broker/BrokerShell';
import { Watermark } from './components/common/Watermark';

/**
 * Gate the app on a resolved session.
 *
 * `loading` is the boot-time session probe: the server, not this browser, is the
 * authority on who's signed in, so there's a round trip before we know.
 *
 * A user who must change their password gets that screen INSTEAD of the routes,
 * not alongside them — otherwise "forced" would mean "suggested".
 */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, mustChangePassword } = useAuth();
  if (loading) return null;
  if (user && mustChangePassword) return <ChangePasswordScreen />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={
        user ? <Navigate to={user.isManager ? '/manager' : '/broker'} /> : <LoginScreen />
      } />
      <Route path="/manager/*" element={
        <ProtectedRoute role="manager">
          <ManagerShell />
        </ProtectedRoute>
      } />
      <Route path="/broker/*" element={
        <ProtectedRoute role="broker">
          <BrokerShell />
        </ProtectedRoute>
      } />
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  );
}

function ProtectedRoute({ children, role }: { children: React.ReactNode; role: string }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  if (role === 'manager' && !user.isManager) return <Navigate to="/broker" />;
  if (role === 'broker' && user.isManager) return <Navigate to="/manager" />;
  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <VaultProvider>
            <AuthGuard>
              <Watermark />
              <AppRoutes />
            </AuthGuard>
          </VaultProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
