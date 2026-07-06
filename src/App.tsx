import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ElectionProvider } from './contexts/ElectionContext';
import nitukLogo from './assets/nituk_logo.svg';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Nominate = lazy(() => import('./pages/Nominate'));
const Vote = lazy(() => import('./pages/Vote'));
const Results = lazy(() => import('./pages/Results'));
const Admin = lazy(() => import('./pages/Admin'));

// Navigation & Logo Header Layout
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, signOut, student } = useAuth();

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-branding-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', margin: '0.5rem 0' }}>
          <img src={nitukLogo} className="header-logo" alt="NIT Uttarakhand Logo" style={{ height: '70px', width: 'auto', flexShrink: 0 }} />
          <div className="header-text-container" style={{ textAlign: 'left' }}>
            <Link to="/" className="app-branding" style={{ margin: 0, display: 'block', fontSize: '2rem' }}>SPR Election Portal</Link>
            <div className="app-subbranding" style={{ marginTop: '0.15rem' }}>DEPARTMENT OF COMPUTER SCIENCE & ENGINEERING - NIT UTTARAKHAND</div>
          </div>
        </div>
        
        {session && (
          <nav className="app-nav">
            <Link to="/" id="nav-dashboard">Dashboard</Link>
            {student?.is_admin && <Link to="/admin" id="nav-admin">Admin Panel</Link>}
            <button onClick={signOut} id="btn-logout">Logout</button>
          </nav>
        )}
      </header>

      <main style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>
    </div>
  );
};

// Route Guard for Protected Pages
const ProtectedRoute: React.FC<{ children: React.ReactNode; adminOnly?: boolean }> = ({ children, adminOnly = false }) => {
  const { session, student, loading, error } = useAuth();

  if (loading) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <span className="mono-data">Retrieving voter credentials...</span>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (error) {
    return (
      <div className="app-container" style={{ justifyContent: 'center' }}>
        <div className="notice-box error">
          <div className="notice-title">Access Restricted</div>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <span className="mono-data">Validating electoral registration...</span>
      </div>
    );
  }

  if (adminOnly && !student.is_admin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

// Route Guard for Login Page
const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <span className="mono-data">Restoring voter session...</span>
      </div>
    );
  }

  if (session) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export const App: React.FC = () => {
  return (
    <Router>
      <AuthProvider>
        <ElectionProvider>
          <AppLayout>
            <Suspense fallback={<div className="mono-data" style={{ padding: '3rem', textAlign: 'center', flexGrow: 1 }}>Loading election view...</div>}>
              <Routes>
                {/* Public Authenticating Route */}
                <Route
                  path="/login"
                  element={
                    <PublicRoute>
                      <Login />
                    </PublicRoute>
                  }
                />

                {/* Private Voter Routes */}
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/nominate"
                  element={
                    <ProtectedRoute>
                      <Nominate />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/vote"
                  element={
                    <ProtectedRoute>
                      <Vote />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/results"
                  element={
                    <ProtectedRoute>
                      <Results />
                    </ProtectedRoute>
                  }
                />

                {/* Private Administrative Route */}
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute adminOnly>
                      <Admin />
                    </ProtectedRoute>
                  }
                />

                {/* Fallback Redirection */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </AppLayout>
        </ElectionProvider>
      </AuthProvider>
    </Router>
  );
};

export default App;
