import { useState } from 'react';
import { Button } from "../components/ui/button.tsx";
import { Input } from '../components/ui/input.tsx';
import { Plus, LayoutDashboard, FileText, Settings, LogOut, ArrowUpRight, Clock, MapPin, User, Bell, Lock, Loader2, CheckCircle2, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import NeedForm from '../components/NeedForm.tsx';
import UrgencyHeatMap from '../components/UrgencyHeatMap.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { toast } from 'sonner';

type View = 'dashboard' | 'reports' | 'settings';

const getAuthHeaders = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
});

export default function NGODashboard() {
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [showForm, setShowForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const { logout } = useAuth();
  const queryClient = useQueryClient();

  // Fetch NGO's needs
  const { data: needs, isLoading, refetch } = useQuery({
    queryKey: ['ngo-needs'],
    queryFn: () => axios.get(`${import.meta.env.VITE_API_URL}/needs`).then(res => res.data),
  });

  // Fetch profile
  const { data: profile } = useQuery({
    queryKey: ['ngo-profile'],
    queryFn: () => axios.get(`${import.meta.env.VITE_API_URL}/users/profile`, getAuthHeaders()).then(res => res.data),
  });

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: (data: any) => axios.patch(`${import.meta.env.VITE_API_URL}/users/profile`, data, getAuthHeaders()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ngo-profile'] });
      toast.success('Profile updated!');
      setEditingProfile(false);
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to update profile.')
  });

  // Change password
  const changePasswordMutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      axios.post(`${import.meta.env.VITE_API_URL}/users/change-password`, data, getAuthHeaders()),
    onSuccess: (res) => {
      toast.success(res.data.message);
      setShowPasswordForm(false);
      setPasswords({ currentPassword: '', newPassword: '' });
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to change password.')
  });

  // Update location mutation
  const updateLocationMutation = useMutation({
    mutationFn: (data: { latitude: number; longitude: number; address?: string }) =>
      axios.patch(`${import.meta.env.VITE_API_URL}/users/location`, data, getAuthHeaders()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ngo-profile'] });
      toast.success('Location and address updated!');
    },
    onError: () => toast.error('Failed to update location.')
  });

  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser.');
      return;
    }
    
    toast.info('Detecting precise location...');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const response = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`);
          const address = response.data.display_name;
          updateLocationMutation.mutate({ latitude, longitude, address });
        } catch (error) {
          updateLocationMutation.mutate({ latitude, longitude });
        }
      },
      () => toast.error('Unable to retrieve location.')
    );
  };

  const handleProfileSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data: any = {};
    formData.forEach((val, key) => { data[key] = val; });
    updateProfileMutation.mutate(data);
  };

  const renderContent = () => {
    switch (activeView) {
      case 'reports':
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center">
              <h2 className="text-3xl font-black">All <span className="text-purple-600">Reports</span></h2>
              <Button onClick={() => setShowForm(true)} className="rounded-2xl bg-purple-600 font-bold"><Plus className="mr-2 h-4 w-4" /> New Report</Button>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-xl p-8">
              {needs?.length > 0 ? (
                <div className="divide-y divide-slate-50 dark:divide-slate-800">
                  {needs.map((need: any) => (
                    <div 
                      key={need._id} 
                      className="py-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all flex flex-col justify-center group rounded-2xl px-4 cursor-pointer"
                      onClick={() => setExpandedTask(expandedTask === need._id ? null : need._id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <h4 className="text-lg font-black group-hover:text-purple-600 transition-colors">{need.title}</h4>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${
                            need.urgency === 'critical' ? 'bg-red-100 text-red-600' :
                            need.urgency === 'high' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'
                          }`}>{need.urgency || 'medium'}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${
                            need.status === 'assigned' ? 'bg-green-100 text-green-600' : 
                            need.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-600'
                          }`}>{need.status}</span>
                        </div>
                        <div className="text-slate-400">
                          {expandedTask === need._id ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                        </div>
                      </div>
                      
                      {expandedTask === need._id && (
                        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 animate-in slide-in-from-top-2 duration-200">
                          <div className="flex items-center gap-4 text-xs font-bold text-slate-400 mb-4">
                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {need.locationName || 'Kalyan'}</span>
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(need.createdAt).toLocaleDateString()}</span>
                          </div>

                          {need.status === 'completed' && need.completionData && (
                            <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl border border-emerald-100 dark:border-emerald-800">
                              <div className="flex items-center gap-2 text-emerald-600 font-bold mb-2 text-sm">
                                <CheckCircle2 className="h-4 w-4" /> Task Completed
                              </div>
                              <p className="text-sm text-slate-600 dark:text-slate-300 mb-1"><strong>People Helped:</strong> {need.completionData.numberOfPeople || 0}</p>
                              <p className="text-sm text-slate-600 dark:text-slate-300 mb-4"><strong>Notes:</strong> {need.completionData.details}</p>
                              <div className="flex gap-4 overflow-x-auto pb-2">
                                {need.completionData.proofImageBase64 && (
                                  <div>
                                    <p className="text-xs text-slate-500 mb-1 font-bold">Proof</p>
                                    <img src={need.completionData.proofImageBase64} alt="Proof" className="h-32 rounded-xl object-cover border border-slate-200" />
                                  </div>
                                )}
                                {need.completionData.departmentLetterBase64 && (
                                  <div>
                                    <p className="text-xs text-slate-500 mb-1 font-bold">Dept. Letter</p>
                                    <img src={need.completionData.departmentLetterBase64} alt="Letter" className="h-32 rounded-xl object-cover border border-slate-200" />
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center py-20 text-slate-400 font-bold italic">No reports found.</p>
              )}
            </div>
          </div>
        );
      case 'settings':
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-3xl font-black">Profile <span className="text-purple-600">Settings</span></h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Account Information */}
              <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-xl p-8 space-y-6">
                <h3 className="text-lg font-black flex items-center gap-2"><User className="h-5 w-5 text-purple-600" /> Account Information</h3>
                {editingProfile ? (
                  <form onSubmit={handleProfileSave} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Organization Name</label>
                      <Input name="orgName" defaultValue={profile?.orgName} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Full Name</label>
                      <Input name="fullName" defaultValue={profile?.fullName} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Address</label>
                      <Input name="address" defaultValue={profile?.address} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium" />
                    </div>
                    <div className="flex gap-3">
                      <Button type="button" variant="outline" onClick={() => setEditingProfile(false)} className="flex-1 rounded-xl font-bold">Cancel</Button>
                      <Button type="submit" disabled={updateProfileMutation.isPending} className="flex-1 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold">
                        {updateProfileMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Save'}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="space-y-4">
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Organization Name</label>
                        <p className="font-bold text-slate-700 dark:text-slate-200">{profile?.orgName || '—'}</p>
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Email Address</label>
                        <p className="font-bold text-slate-700 dark:text-slate-200">{profile?.email || '—'}</p>
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Verification Status</label>
                        <p className={`font-bold ${profile?.isVerified ? 'text-emerald-600' : 'text-orange-500'}`}>
                          {profile?.isVerified ? '✓ Verified' : '⏳ Pending Admin Approval'}
                        </p>
                      </div>
                    </div>
                    <Button variant="outline" onClick={() => setEditingProfile(true)} className="w-full rounded-2xl font-bold">Edit Profile</Button>
                  </>
                )}
              </div>

              {/* Location Dynamic Card */}
              <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-xl p-8 space-y-6">
                <h3 className="text-lg font-black flex items-center gap-2 text-purple-600"><MapPin className="h-5 w-5" /> Operational Base</h3>
                {profile?.address ? (
                  <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-2xl border border-purple-100 dark:border-purple-800/30 space-y-2">
                    <p className="text-[10px] font-black uppercase text-purple-400 tracking-widest">Saved Address</p>
                    <p className="text-sm text-purple-700 dark:text-purple-300 font-bold leading-relaxed">{profile.address}</p>
                    {profile?.currentLocation?.coordinates?.length === 2 && (
                      <p className="text-[10px] text-purple-400 font-medium italic">
                        GPS: {profile.currentLocation.coordinates[1].toFixed(4)}°N, {profile.currentLocation.coordinates[0].toFixed(4)}°E
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 leading-relaxed italic">
                    Set your organization's operational base to help us coordinate local responses effectively.
                  </p>
                )}
                <Button onClick={handleDetectLocation} disabled={updateLocationMutation.isPending}
                  className="w-full h-12 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-black transition-all active:scale-[0.98]">
                  {updateLocationMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Sparkles className="mr-2 h-5 w-5" />Detect Operations Base</>}
                </Button>
              </div>

              {/* Notifications */}
              <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-xl p-8 space-y-6">
                <h3 className="text-lg font-black flex items-center gap-2"><Bell className="h-5 w-5 text-purple-600" /> Notifications</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">Email Alerts</span>
                    <div className="w-10 h-5 bg-purple-600 rounded-full relative cursor-pointer"><div className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm" /></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">New Matches</span>
                    <div className="w-10 h-5 bg-purple-600 rounded-full relative cursor-pointer"><div className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm" /></div>
                  </div>
                </div>
              </div>

              {/* Security */}
              <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-xl p-8 space-y-6 md:col-span-2">
                <h3 className="text-lg font-black flex items-center gap-2"><Lock className="h-5 w-5 text-purple-600" /> Security</h3>
                {showPasswordForm ? (
                  <div className="space-y-4 max-w-md">
                    <Input type="password" placeholder="Current Password" value={passwords.currentPassword}
                      onChange={e => setPasswords(p => ({ ...p, currentPassword: e.target.value }))}
                      className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium" />
                    <Input type="password" placeholder="New Password (min 6 chars)" value={passwords.newPassword}
                      onChange={e => setPasswords(p => ({ ...p, newPassword: e.target.value }))}
                      className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium" />
                    <div className="flex gap-3">
                      <Button variant="outline" onClick={() => setShowPasswordForm(false)} className="rounded-2xl font-bold">Cancel</Button>
                      <Button onClick={() => changePasswordMutation.mutate(passwords)}
                        disabled={changePasswordMutation.isPending}
                        className="rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold">
                        {changePasswordMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Change Password'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setShowPasswordForm(true)} className="rounded-2xl font-bold">Change Password</Button>
                )}
              </div>
            </div>
          </div>
        );
      default:
        return (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10">
              <div>
                <h1 className="text-4xl font-black tracking-tight">Kalyān <span className="text-purple-600">Operations</span></h1>
                <p className="text-slate-500 font-medium">Monitoring and responding to regional humanitarian needs.</p>
              </div>
              <Button onClick={() => setShowForm(true)}
                className="rounded-2xl h-14 px-8 font-black text-lg bg-purple-600 hover:bg-purple-700 shadow-xl shadow-purple-200 dark:shadow-none transition-all hover:scale-105 active:scale-95">
                <Plus className="mr-2 h-6 w-6" /> Post New Need
              </Button>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
              <div className="p-8 bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-xl group hover:border-purple-200 transition-all">
                <div className="flex justify-between items-start mb-4">
                  <div className="bg-purple-50 p-3 rounded-2xl"><FileText className="h-6 w-6 text-purple-600" /></div>
                  <ArrowUpRight className="h-5 w-5 text-slate-300 group-hover:text-purple-500 transition-colors" />
                </div>
                <h3 className="text-slate-400 font-bold uppercase text-[10px] tracking-widest mb-1">Active Posts</h3>
                <p className="text-4xl font-black">{needs?.filter((n: any) => n.status === 'pending').length || 0}</p>
              </div>
              <div className="p-8 bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-xl">
                <div className="bg-green-50 p-3 rounded-2xl w-fit mb-4"><ArrowUpRight className="h-6 w-6 text-green-600" /></div>
                <h3 className="text-slate-400 font-bold uppercase text-[10px] tracking-widest mb-1">Assigned</h3>
                <p className="text-4xl font-black">{needs?.filter((n: any) => n.status === 'assigned').length || 0}</p>
              </div>
              <div className="p-8 bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-xl">
                <div className="bg-blue-50 p-3 rounded-2xl w-fit mb-4"><FileText className="h-6 w-6 text-blue-600" /></div>
                <h3 className="text-slate-400 font-bold uppercase text-[10px] tracking-widest mb-1">Total Posts</h3>
                <p className="text-4xl font-black">{needs?.length || 0}</p>
              </div>
            </div>

            <div className="mb-10">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-black">Regional <span className="text-purple-600">Urgency Heatmap</span></h3>
                <p className="text-xs font-bold text-slate-400">Live density of reported needs in Kalyan-Dombivli</p>
              </div>
              <div className="bg-white dark:bg-slate-900 p-2 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-2xl overflow-hidden">
                <UrgencyHeatMap tasks={needs || []} />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-2xl overflow-hidden">
              <div className="p-8 border-b border-slate-50 dark:border-slate-800 flex justify-between items-center">
                <h3 className="text-xl font-black">Recent Activity</h3>
              </div>
              <div className="p-2">
                {isLoading ? (
                  <div className="p-20 text-center text-slate-400 font-bold italic">Gathering regional data...</div>
                ) : needs?.length === 0 ? (
                  <div className="p-20 text-center space-y-4">
                    <div className="bg-slate-50 p-6 rounded-full w-fit mx-auto"><FileText className="h-12 w-12 text-slate-300" /></div>
                    <div>
                      <h4 className="text-lg font-bold">No active needs posted</h4>
                      <p className="text-sm text-slate-500">Your published needs will appear here for volunteer matching.</p>
                    </div>
                    <Button variant="outline" onClick={() => setShowForm(true)} className="rounded-xl font-bold">Start First Report</Button>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-50 dark:divide-slate-800">
                    {needs.map((need: any) => (
                      <div 
                        key={need._id} 
                        className="p-6 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all flex flex-col justify-center group cursor-pointer"
                        onClick={() => setExpandedTask(expandedTask === need._id ? null : need._id)}
                      >
                        <div className="flex justify-between items-center w-full">
                          <div className="flex items-center gap-3">
                            <h4 className="text-lg font-black group-hover:text-purple-600 transition-colors">{need.title}</h4>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${
                              need.urgency === 'critical' ? 'bg-red-100 text-red-600' :
                              need.urgency === 'high' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'
                            }`}>{need.urgency || 'medium'}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${
                              need.status === 'assigned' ? 'bg-green-100 text-green-600' : 
                              need.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-600'
                            }`}>{need.status}</span>
                          </div>
                          <div className="text-slate-400">
                            {expandedTask === need._id ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                          </div>
                        </div>
                        
                        {expandedTask === need._id && (
                          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 animate-in slide-in-from-top-2 duration-200">
                            <div className="flex items-center gap-4 text-xs font-bold text-slate-400 mb-4">
                              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {need.locationName || 'Kalyan'}</span>
                              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(need.createdAt).toLocaleDateString()}</span>
                            </div>

                            {need.status === 'completed' && need.completionData && (
                              <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl border border-emerald-100 dark:border-emerald-800">
                                <div className="flex items-center gap-2 text-emerald-600 font-bold mb-2 text-sm">
                                  <CheckCircle2 className="h-4 w-4" /> Task Completed
                                </div>
                                <p className="text-sm text-slate-600 dark:text-slate-300 mb-1"><strong>People Helped:</strong> {need.completionData.numberOfPeople || 0}</p>
                                <p className="text-sm text-slate-600 dark:text-slate-300 mb-4"><strong>Notes:</strong> {need.completionData.details}</p>
                                <div className="flex gap-4 overflow-x-auto pb-2">
                                  {need.completionData.proofImageBase64 && (
                                    <div>
                                      <p className="text-xs text-slate-500 mb-1 font-bold">Proof</p>
                                      <img src={need.completionData.proofImageBase64} alt="Proof" className="h-32 rounded-xl object-cover border border-slate-200" />
                                    </div>
                                  )}
                                  {need.completionData.departmentLetterBase64 && (
                                    <div>
                                      <p className="text-xs text-slate-500 mb-1 font-bold">Dept. Letter</p>
                                      <img src={need.completionData.departmentLetterBase64} alt="Letter" className="h-32 rounded-xl object-cover border border-slate-200" />
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50/50 dark:bg-slate-950">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-white dark:bg-slate-900 hidden lg:flex flex-col p-6 sticky top-0 h-screen">
        <div className="flex items-center gap-2 mb-10 px-2">
          <div className="bg-purple-600 p-1.5 rounded-lg"><LayoutDashboard className="h-5 w-5 text-white" /></div>
          <span className="text-xl font-black italic tracking-tight">NGO <span className="text-purple-600">Portal</span></span>
        </div>
        <nav className="flex-1 space-y-2">
          {[
            { key: 'dashboard' as View, icon: LayoutDashboard, label: 'Dashboard' },
            { key: 'reports' as View, icon: FileText, label: 'All Reports' },
            { key: 'settings' as View, icon: Settings, label: 'Settings' },
          ].map(item => (
            <button key={item.key} onClick={() => setActiveView(item.key)}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-2xl font-bold transition-all ${
                activeView === item.key ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}>
              <item.icon className="h-5 w-5" /> {item.label}
            </button>
          ))}
        </nav>
        <button onClick={logout}
          className="flex items-center gap-3 w-full px-4 py-3 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-2xl font-bold transition-all mt-auto">
          <LogOut className="h-5 w-5" /> Logout
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-10 max-w-6xl">
        {renderContent()}
        {showForm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-10 overflow-y-auto">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowForm(false)} />
            <div className="relative w-full max-w-4xl z-10">
              <NeedForm onSuccess={() => { setShowForm(false); refetch(); }} onCancel={() => setShowForm(false)} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
