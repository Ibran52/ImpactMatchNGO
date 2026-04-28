import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.tsx';
import { Button } from '../components/ui/button.tsx';
import axios from 'axios';
import { toast } from 'sonner';
import { Shield, Lock, Mail, Loader2, ArrowRight, Fingerprint } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.post(`${import.meta.env.VITE_API_URL}/auth/login`, { email, password });
      login(res.data.token, res.data);
      toast.success('Access granted. Welcome back.');
      navigate(`/${res.data.role}`);
    } catch (error: any) {
      console.error('Login Error:', error);
      const message = error.response?.data?.message || error.message || 'Login failed. Please check your credentials.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[90vh] flex items-center justify-center p-6 bg-slate-50/50 dark:bg-slate-950/50 container mx-auto px-4">
      <div className="absolute top-0 left-0 w-full h-1/2 bg-indigo-600/5 -z-10 blur-[100px] rounded-full" />
      
      <div className="w-full max-w-xl">
        <div className="mb-10 text-center space-y-2">
          <div className="bg-indigo-600 p-3 rounded-2xl w-fit mx-auto mb-6 shadow-xl shadow-indigo-200">
            <Fingerprint className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-4xl font-black tracking-tight text-slate-900 dark:text-white">Secure <span className="text-indigo-600">Access</span></h1>
          <p className="text-slate-500 font-medium tracking-wide">Enter your humanitarian portal credentials.</p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-2xl p-10 md:p-14 transition-all hover:border-indigo-100 group">
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                  <Mail className="h-3 w-3" /> System Email
                </label>
                <input 
                  type="email" 
                  className="w-full h-14 px-6 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 text-lg font-medium focus:ring-2 focus:ring-indigo-600 outline-none transition-all group-hover:bg-white dark:group-hover:bg-slate-900"
                  placeholder="e.g. ops@kalyan.org"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                    <Lock className="h-3 w-3" /> Keyphrase
                  </label>
                  <button type="button" className="text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:underline">Forgot Access?</button>
                </div>
                <input 
                  type="password" 
                  className="w-full h-14 px-6 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 text-lg font-medium focus:ring-2 focus:ring-indigo-600 outline-none transition-all group-hover:bg-white dark:group-hover:bg-slate-900"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <Button 
              className="w-full h-16 rounded-2xl text-lg font-black bg-slate-900 dark:bg-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 shadow-2xl transition-all active:scale-95"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin mx-auto" />
              ) : (
                <div className="flex items-center justify-center gap-2">
                  Initialize Session <ArrowRight className="h-5 w-5" />
                </div>
              )}
            </Button>
          </form>

          <div className="mt-12 pt-8 border-t border-slate-50 dark:border-slate-800 text-center space-y-4">
            <p className="text-sm font-medium text-slate-500 italic">
              Don't have an operational account yet?
            </p>
            <Link to="/register" className="inline-flex items-center gap-2 text-indigo-600 font-black tracking-widest uppercase text-xs hover:gap-3 transition-all">
              Register New Entity <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        <div className="mt-10 flex items-center justify-center gap-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
          <span className="flex items-center gap-1.5"><Shield className="h-3 w-3" /> ISO 27001 Compliant</span>
          <span className="w-1 h-1 bg-slate-200 rounded-full" />
          <span className="flex items-center gap-1.5"><Lock className="h-3 w-3" /> AES-256 Encrypted</span>
        </div>
      </div>
    </div>
  );
};

export default Login;
