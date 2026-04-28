import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Button } from './ui/button';
import { Heart, Sun, Moon } from 'lucide-react';

const Navbar = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="border-b bg-white dark:bg-slate-950 sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center space-x-2">
          <div className="bg-indigo-600 p-1.5 rounded-lg">
            <Heart className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-black tracking-tight">Impact<span className="text-indigo-600">Match</span></span>
        </Link>

        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-xl">
            {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </Button>
          
          {user ? (
            <>
              <span className="text-sm font-medium hidden md:inline-block">Welcome, {user.email}</span>
              <Button variant="ghost" onClick={logout} className="rounded-xl font-bold">Logout</Button>
              <Button asChild className="rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700">
                <Link to={`/${user.role}`}>Dashboard</Link>
              </Button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-sm font-bold hover:text-indigo-600 transition-colors uppercase tracking-widest text-xs">Login</Link>
              <Button asChild className="rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700">
                <Link to="/register">Join Us</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
