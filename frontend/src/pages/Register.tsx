import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.tsx';
import { Button } from '../components/ui/button.tsx';
import axios from 'axios';
import { toast } from 'sonner';
import { UserPlus, Building2, User, Mail, Lock, Loader2, Sparkles, ShieldCheck, MapPin } from 'lucide-react';

const Register = () => {
  const [searchParams] = useSearchParams();
  const [role, setRole] = useState(searchParams.get('role') || 'volunteer');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [loading, setLoading] = useState(false);
  const [locationName, setLocationName] = useState('');
  const [coords, setCoords] = useState<{lat: number, lng: number} | null>(null);
  const [detecting, setDetecting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser.');
      return;
    }
    
    setDetecting(true);
    toast.info('Detecting precise location...');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setCoords({ lat: latitude, lng: longitude });
        try {
          const response = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`);
          setLocationName(response.data.display_name);
          toast.success('Location detected!');
        } catch (error) {
          setLocationName(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
          toast.success('Coordinates detected!');
        } finally {
          setDetecting(false);
        }
      },
      () => {
        toast.error('Unable to retrieve location.');
        setDetecting(false);
      }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.post(`${import.meta.env.VITE_API_URL}/auth/register`, { 
        email, 
        password, 
        role, 
        fullName, 
        orgName,
        address: locationName,
        latitude: coords?.lat,
        longitude: coords?.lng
      });
      login(res.data.token, res.data);
      toast.success('Registration successful. Welcome to the network.');
      navigate(`/${res.data.role}`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[90vh] flex items-center justify-center p-6 bg-slate-50/50 dark:bg-slate-950/50 container mx-auto px-4">
      <div className="absolute top-0 right-0 w-full h-1/2 bg-emerald-600/5 -z-10 blur-[100px] rounded-full" />
      
      <div className="w-full max-w-2xl">
        <div className="mb-10 text-center space-y-4">
          <div className="bg-emerald-600 p-3 rounded-2xl w-fit mx-auto shadow-xl shadow-emerald-200">
            <UserPlus className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-4xl font-black tracking-tight text-slate-900 dark:text-white">Join <span className="text-emerald-600">ImpactMatch</span></h1>
          <p className="text-slate-500 font-medium max-w-md mx-auto">Initialize your humanitarian profile to start contributing to the Kalyan regional response.</p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-2xl p-8 md:p-14 overflow-hidden relative group">
          <div className="absolute top-0 left-0 w-1 h-full bg-emerald-600 opacity-20 group-hover:opacity-100 transition-opacity" />
          
          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Role Selection */}
            <div className="p-2 bg-slate-50/80 dark:bg-slate-800/50 rounded-2xl grid grid-cols-2 gap-2 border border-slate-100 dark:border-slate-700">
              <button 
                type="button"
                onClick={() => setRole('volunteer')}
                className={`flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-black tracking-widest uppercase transition-all ${
                  role === 'volunteer' 
                  ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm ring-1 ring-slate-200' 
                  : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <User className="h-4 w-4" /> Volunteer
              </button>
              <button 
                type="button"
                onClick={() => setRole('ngo')}
                className={`flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-black tracking-widest uppercase transition-all ${
                  role === 'ngo' 
                  ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm ring-1 ring-slate-200' 
                  : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Building2 className="h-4 w-4" /> NGO / Org
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2 px-1">
                  <User className="h-3 w-3" /> Full Name
                </label>
                <input 
                  type="text" 
                  className="w-full h-12 px-5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 font-medium focus:ring-2 focus:ring-emerald-600 outline-none transition-all"
                  placeholder="John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              {role === 'ngo' ? (
                <div className="space-y-2 animate-in fade-in slide-in-from-left-4 duration-500">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2 px-1">
                    <Building2 className="h-3 w-3" /> Organization
                  </label>
                  <input 
                    type="text" 
                    className="w-full h-12 px-5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 font-medium focus:ring-2 focus:ring-emerald-600 outline-none transition-all"
                    placeholder="Kalyan Help Group"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    required
                  />
                </div>
              ) : (
                <div className="space-y-2 animate-in fade-in slide-in-from-right-4 duration-500">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2 px-1">
                    <ShieldCheck className="h-3 w-3" /> Aadhaar Number
                  </label>
                  <input 
                    type="text" 
                    className="w-full h-12 px-5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 font-medium focus:ring-2 focus:ring-emerald-600 outline-none transition-all"
                    placeholder="1234 5678 9012"
                    required
                  />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2 px-1">
                  <Mail className="h-3 w-3" /> Email
                </label>
                <input 
                  type="email" 
                  className="w-full h-12 px-5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 font-medium focus:ring-2 focus:ring-emerald-600 outline-none transition-all"
                  placeholder="j.doe@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2 px-1">
                  <Lock className="h-3 w-3" /> Secret Key
                </label>
                <input 
                  type="password" 
                  className="w-full h-12 px-5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 font-medium focus:ring-2 focus:ring-emerald-600 outline-none transition-all"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {role === 'volunteer' && (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2 px-1">
                      <Sparkles className="h-3 w-3" /> Skills (e.g. First Aid, Logistics)
                    </label>
                    <input 
                      type="text" 
                      className="w-full h-12 px-5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 font-medium focus:ring-2 focus:ring-emerald-600 outline-none transition-all"
                      placeholder="Enter skills separated by commas"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2 px-1">
                      <Loader2 className="h-3 w-3" /> Availability
                    </label>
                    <select className="w-full h-12 px-5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 font-medium focus:ring-2 focus:ring-emerald-600 outline-none transition-all">
                      <option>Weekends Only</option>
                      <option>Weekdays Only</option>
                      <option>Full Time</option>
                      <option>Emergency Only</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            <div className="p-4 bg-emerald-50 dark:bg-emerald-900/10 rounded-2xl border border-emerald-100 dark:border-emerald-800/50 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400">Base Location</h3>
              </div>
              
              <div className="relative group">
                <input 
                  type="text" 
                  className="w-full h-12 pl-5 pr-12 rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900 font-medium focus:ring-2 focus:ring-emerald-600 outline-none transition-all text-sm"
                  placeholder="Home address or organization base"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  required
                />
                <button 
                  type="button"
                  onClick={handleDetectLocation}
                  disabled={detecting}
                  className="absolute right-2 top-1.5 h-9 w-9 flex items-center justify-center bg-emerald-100 dark:bg-emerald-800 text-emerald-600 dark:text-emerald-300 rounded-xl hover:bg-emerald-200 transition-colors"
                >
                  {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                </button>
              </div>
              
              <p className="text-[10px] leading-relaxed text-emerald-700/70 dark:text-emerald-400/70 font-medium italic">
                Set your primary operational area. We use this to match you with needs in the Kalyan district.
              </p>
            </div>

            <Button 
              className="w-full h-16 rounded-2xl text-lg font-black bg-emerald-600 hover:bg-emerald-700 text-white shadow-xl shadow-emerald-100 dark:shadow-none transition-all active:scale-95"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin mx-auto" />
              ) : (
                <div className="flex items-center justify-center gap-2">
                  Create Operational Profile <Sparkles className="h-5 w-5" />
                </div>
              )}
            </Button>
          </form>

          <div className="mt-10 text-center">
            <Link to="/login" className="text-xs font-black uppercase tracking-widest text-slate-400 hover:text-emerald-600 transition-colors">
              Already verified? <span className="text-emerald-600">Access Portal</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
