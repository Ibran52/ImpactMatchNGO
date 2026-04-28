import { Link } from 'react-router-dom';
import { Button } from '../components/ui/button.tsx';
import { ShieldCheck, Zap, Globe, Award } from 'lucide-react';
import { useTheme } from '../context/ThemeContext.tsx';

const Home = () => {
  const { theme } = useTheme();

  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero Section */}
      <section className="relative pt-20 pb-32 overflow-hidden bg-white dark:bg-background transition-colors duration-500">
        <div className="absolute top-0 left-0 w-full h-full opacity-30">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-600 rounded-full blur-[120px]" />
        </div>

        <div className="container relative z-10 px-6 mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-8 border border-white/10 rounded-full bg-white/5 backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-700">
            <Award className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span className="text-xs font-black tracking-widest text-slate-500 dark:text-white uppercase">Humanitarian Excellence Platform</span>
          </div>

          <h1 className="max-w-4xl mx-auto mb-8 text-5xl font-black leading-tight text-slate-900 dark:text-white md:text-7xl lg:text-8xl tracking-tighter animate-in fade-in slide-in-from-bottom-8 duration-1000">
            Empowering <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-emerald-600 dark:from-indigo-400 dark:to-emerald-400">Kalyān</span> Through AI Matching.
          </h1>

          <p className="max-w-2xl mx-auto mb-12 text-lg font-medium text-slate-600 dark:text-slate-400 md:text-xl animate-in fade-in duration-1000 delay-300">
            A specialized logistics and coordination network connecting ground-level needs with verified humanitarian responders in the Kalyan region.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row animate-in fade-in duration-1000 delay-500">
            <Link to="/register?role=ngo">
              <Button 
                size="lg" 
                className={`h-16 px-10 text-lg font-black rounded-2xl shadow-2xl transition-all ${
                  theme === 'light' 
                  ? 'bg-white text-slate-950 hover:bg-slate-100 shadow-white/10' 
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-900/20'
                }`}
              >
                Partner as NGO
              </Button>
            </Link>
            <Link to="/register?role=volunteer">
              <Button 
                size="lg" 
                variant="outline" 
                className={`h-16 px-10 text-lg font-black rounded-2xl transition-all ${
                  theme === 'light' 
                  ? 'bg-white text-slate-950 hover:bg-slate-100 shadow-white/10' 
                  : 'border-white/20 text-white hover:bg-white/5'
                }`}
              >
                Join as Volunteer
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Trust & Stats Section */}
      <section className="py-20 bg-white dark:bg-slate-900">
        <div className="container px-6 mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-12 text-center">
            <div className="space-y-2">
              <p className="text-4xl font-black text-slate-900 dark:text-white">50+</p>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Verified NGOs</p>
            </div>
            <div className="space-y-2">
              <p className="text-4xl font-black text-indigo-600">1.2k</p>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Active Responders</p>
            </div>
            <div className="space-y-2">
              <p className="text-4xl font-black text-slate-900 dark:text-white">8.4k</p>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Lives Impacted</p>
            </div>
            <div className="space-y-2">
              <p className="text-4xl font-black text-emerald-600">98%</p>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Match Accuracy</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-32 bg-slate-50 dark:bg-slate-950">
        <div className="container px-6 mx-auto">
          <div className="max-w-3xl mb-20">
            <h2 className="text-4xl font-black text-slate-900 dark:text-white mb-6">Designed for <span className="text-indigo-600 italic">Resilience</span>.</h2>
            <p className="text-lg text-slate-600 dark:text-slate-400 font-medium">Our platform leverages advanced AI to ensure no humanitarian need goes unmet, bridging the gap between intention and action.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: <Zap className="h-8 w-8" />,
                title: "AI Response",
                desc: "Gemini-powered analysis of field reports for instant urgency classification and automated matching.",
                color: "bg-indigo-50 text-indigo-600"
              },
              {
                icon: <ShieldCheck className="h-8 w-8" />,
                title: "Verified Trust",
                desc: "Strict verification for NGOs and background-checked volunteers ensure high-integrity operations.",
                color: "bg-emerald-50 text-emerald-600"
              },
              {
                icon: <Globe className="h-8 w-8" />,
                title: "Regional Focus",
                desc: "Deeply localized mapping and coordination tailored for the unique landscape of Kalyan.",
                color: "bg-blue-50 text-blue-600"
              }
            ].map((feature, i) => (
              <div key={i} className="p-10 bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-xl hover:shadow-2xl transition-all group">
                <div className={`${feature.color} p-5 rounded-3xl w-fit mb-8 group-hover:scale-110 transition-transform`}>
                  {feature.icon}
                </div>
                <h3 className="text-2xl font-black mb-4">{feature.title}</h3>
                <p className="text-slate-500 font-medium leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-20">
        <div className="container px-6 mx-auto">
          <div className="relative p-12 md:p-20 bg-slate-50 dark:bg-slate-900 rounded-[4rem] text-slate-900 dark:text-white overflow-hidden text-center shadow-2xl border border-slate-100 dark:border-slate-800 transition-all hover:border-emerald-200">
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-600/5 rounded-full blur-3xl -mr-20 -mt-20" />
            <div className="relative z-10 max-w-2xl mx-auto space-y-8">
              <h2 className="text-4xl md:text-5xl font-black tracking-tight italic">Ready to make a <span className="text-emerald-600">difference?</span></h2>
              <p className="text-lg text-slate-500 dark:text-slate-400 font-medium leading-relaxed">Join the network and start responding to humanitarian needs in real-time. Join as a partner organization or an individual responder.</p>
              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <Link to="/register">
                  <Button size="lg" className="h-16 px-12 text-lg font-black bg-emerald-600 hover:bg-emerald-700 text-white dark:text-white rounded-2xl shadow-xl shadow-emerald-200 dark:shadow-none">
                    Get Started Now
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="py-12 border-t border-slate-100 dark:border-slate-800 text-center">
        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">&copy; 2026 ImpactMatch • Kalyan District Operations</p>
      </footer>
    </div>
  );
};

export default Home;
