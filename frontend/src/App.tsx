import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import Home from './pages/Home.tsx';
import Login from './pages/Login.tsx';
import Register from './pages/Register.tsx';
import AdminDashboard from './pages/AdminDashboard.tsx';
import NGODashboard from './pages/NGODashboard.tsx';
import VolunteerDashboard from './pages/VolunteerDashboard.tsx';
import Navbar from './components/Navbar.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { ThemeProvider } from './context/ThemeContext.tsx';

const ProtectedRoute = ({ children, role }: { children: React.ReactElement, role?: string }) => {
  const { user, loading } = useAuth();
  
  if (loading) return <div>Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  if (role && user.role !== role) return <Navigate to="/" />;
  
  return children;
};

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <Router>
            <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-300">
              <Navbar />
              <main>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />
                  
                  <Route path="/admin/*" element={
                    <ProtectedRoute role="admin">
                      <AdminDashboard />
                    </ProtectedRoute>
                  } />
                  
                  <Route path="/ngo/*" element={
                    <ProtectedRoute role="ngo">
                      <NGODashboard />
                    </ProtectedRoute>
                  } />
                  
                  <Route path="/volunteer/*" element={
                    <ProtectedRoute role="volunteer">
                      <VolunteerDashboard />
                    </ProtectedRoute>
                  } />
                </Routes>
              </main>
              <Toaster position="top-right" richColors />
            </div>
          </Router>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
