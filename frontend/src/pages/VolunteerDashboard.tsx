import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Button } from "../components/ui/button.tsx";
import { Heart, MapPin, Search, Filter, Zap, User, Settings, GraduationCap, Briefcase, Phone, Home, Loader2, Upload, ShieldCheck, FileCheck, Lock, Navigation, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { Input } from '../components/ui/input.tsx';
import { Card } from '../components/ui/card.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { toast } from 'sonner';
import UrgencyHeatMap from '../components/UrgencyHeatMap.tsx';

const getAuthHeaders = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
});

export default function VolunteerDashboard() {
  const [view, setView] = useState<'feed' | 'profile'>('feed');
  const [verifyFile, setVerifyFile] = useState<File | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [completingTask, setCompletingTask] = useState<any>(null);
  const [completionFile, setCompletionFile] = useState<File | null>(null);
  const [departmentLetterFile, setDepartmentLetterFile] = useState<File | null>(null);
  const [completionDetails, setCompletionDetails] = useState('');
  const [numberOfPeople, setNumberOfPeople] = useState('');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Fetch available needs
  const { data: needs, isLoading: loadingNeeds } = useQuery({
    queryKey: ['available-needs'],
    queryFn: () => axios.get(`${import.meta.env.VITE_API_URL}/needs`).then(res => res.data),
    enabled: view === 'feed'
  });

  // Fetch my profile
  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ['volunteer-profile'],
    queryFn: () => axios.get(`${import.meta.env.VITE_API_URL}/users/profile`, getAuthHeaders()).then(res => res.data),
    enabled: view === 'profile'
  });

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: (updatedData: any) =>
      axios.patch(`${import.meta.env.VITE_API_URL}/users/profile`, updatedData, getAuthHeaders()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['volunteer-profile'] });
      toast.success('Profile updated successfully!');
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to update profile.')
  });

  // Join task mutation
  const joinTaskMutation = useMutation({
    mutationFn: (needId: string) =>
      axios.post(`${import.meta.env.VITE_API_URL}/users/join-task/${needId}`, {}, getAuthHeaders()),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['available-needs'] });
      toast.success(res.data.message || 'Task joined successfully!');
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to join task.')
  });

  // Complete task mutation
  const completeTaskMutation = useMutation({
    mutationFn: (data: { needId: string, proof: File, letter: File | null, details: string, people: string }) => {
      const formData = new FormData();
      formData.append('proofImage', data.proof);
      if (data.letter) formData.append('departmentLetter', data.letter);
      formData.append('details', data.details);
      formData.append('numberOfPeople', data.people);
      return axios.post(`${import.meta.env.VITE_API_URL}/needs/${data.needId}/complete`, formData, getAuthHeaders());
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['available-needs'] });
      toast.success(res.data.message || 'Task completed successfully!');
      setCompletingTask(null);
      setCompletionFile(null);
      setDepartmentLetterFile(null);
      setCompletionDetails('');
      setNumberOfPeople('');
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to complete task.')
  });

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      axios.post(`${import.meta.env.VITE_API_URL}/users/change-password`, data, getAuthHeaders()),
    onSuccess: (res) => {
      toast.success(res.data.message || 'Password changed!');
      setShowPasswordModal(false);
      setPasswords({ currentPassword: '', newPassword: '' });
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to change password.')
  });

  // Update location mutation
  const updateLocationMutation = useMutation({
    mutationFn: (data: { latitude: number; longitude: number; address?: string }) =>
      axios.patch(`${import.meta.env.VITE_API_URL}/users/location`, data, getAuthHeaders()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['volunteer-profile'] });
      toast.success('Location and address updated!');
    },
    onError: () => toast.error('Failed to update location.')
  });

  // Document verification mutation
  const verifyMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('document', file);
      return axios.post(`${import.meta.env.VITE_API_URL}/users/verify`, formData, getAuthHeaders());
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['volunteer-profile'] });
      const data = res.data;
      if (data.success) {
        toast.success(`Verified! ${data.detectedSkills?.length ? `Skills: ${data.detectedSkills.join(', ')}` : ''}`);
      } else {
        toast.error(data.message || 'Verification failed.');
      }
    },
    onError: () => toast.error('Document verification failed.')
  });

  const handleUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data: any = {};
    formData.forEach((value, key) => { data[key] = value; });
    if (data.skills) data.skills = data.skills.split(',').map((s: string) => s.trim());
    updateProfileMutation.mutate(data);
  };

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
          // Reverse geocoding using Nominatim (free OSM service)
          const response = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`);
          const address = response.data.display_name;
          updateLocationMutation.mutate({ latitude, longitude, address });
        } catch (error) {
          console.error('Reverse geocoding error:', error);
          // Fallback to just coordinates if geocoding fails
          updateLocationMutation.mutate({ latitude, longitude });
        }
      },
      () => toast.error('Unable to retrieve your location. Please allow location access.')
    );
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-10 pb-20">
      {/* Navigation Tabs */}
      <div className="flex gap-4 p-1.5 bg-slate-100 dark:bg-slate-900 rounded-2xl w-fit">
        <button onClick={() => setView('feed')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-black transition-all ${view === 'feed' ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
          <Zap className="h-4 w-4" /> Opportunities
        </button>
        <button onClick={() => setView('profile')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-black transition-all ${view === 'profile' ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
          <User className="h-4 w-4" /> My Profile
        </button>
      </div>

      {view === 'feed' ? (
        <>
          {/* Hero */}
          <div className="relative p-10 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-[3rem] text-white overflow-hidden shadow-2xl">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -mr-20 -mt-20" />
            <div className="relative z-10 max-w-2xl space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 rounded-full text-xs font-bold backdrop-blur-md">
                <Zap className="h-3.5 w-3.5 text-yellow-300" /><span>Kalyān Response Team</span>
              </div>
              <h1 className="text-5xl font-black tracking-tight">Make an <span className="text-blue-200 italic">Impact</span> today.</h1>
              <p className="text-blue-100 text-lg font-medium opacity-90 leading-relaxed">
                Your skills can save lives. Browse verified humanitarian needs and contribute to the community response.
              </p>
            </div>
          </div>

          {/* Heatmap Overview */}
          <div className="space-y-4">
            <div className="flex justify-between items-center px-4">
              <h3 className="text-xl font-black">Regional <span className="text-blue-600">Urgency Heatmap</span></h3>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Live hotspots in Kalyan</p>
            </div>
            <div className="bg-white dark:bg-slate-900 p-2 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-xl overflow-hidden">
              <UrgencyHeatMap tasks={needs || []} />
            </div>
          </div>

          {/* Search & Filter */}
          <div className="flex flex-col md:flex-row gap-4 items-center bg-white dark:bg-slate-900 p-4 rounded-3xl shadow-xl border border-slate-100 dark:border-slate-800">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
              <Input placeholder="Search tasks, locations, or skills..." className="pl-12 h-12 rounded-2xl border-none bg-slate-50 dark:bg-slate-800" />
            </div>
            <Button variant="outline" className="rounded-2xl h-12 px-6 font-bold flex items-center gap-2 w-full md:w-auto">
              <Filter className="h-4 w-4" /> Filters
            </Button>
          </div>

          {/* Feed List (Accordion Style) */}
          <div className="space-y-4">
            {loadingNeeds ? (
              Array(6).fill(0).map((_, i) => <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800 animate-pulse rounded-2xl" />)
            ) : needs?.length === 0 ? (
              <div className="py-20 text-center">
                <h3 className="text-xl font-bold text-slate-400">No active needs in your area.</h3>
              </div>
            ) : (
              needs?.map((need: any) => (
                <div 
                  key={need._id} 
                  className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-lg overflow-hidden transition-all group"
                >
                  <div 
                    className="p-6 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    onClick={() => setExpandedTask(expandedTask === need._id ? null : need._id)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="bg-blue-50 dark:bg-blue-900/30 p-2.5 rounded-xl">
                        <Heart className="h-5 w-5 text-blue-600" />
                      </div>
                      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                        <h3 className="text-lg font-black group-hover:text-blue-600 transition-colors">{need.title}</h3>
                        <div className="flex gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${
                            need.urgency === 'critical' ? 'bg-red-500 text-white' :
                            need.urgency === 'high' ? 'bg-orange-100 text-orange-600' :
                            need.urgency === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-100 text-slate-500'
                          }`}>{need.urgency || 'medium'}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${
                            need.status === 'assigned' ? 'bg-orange-100 text-orange-600' : 
                            need.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : 'bg-green-100 text-green-600'
                          }`}>{need.status === 'pending' ? 'Open' : need.status}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-slate-400">
                      {expandedTask === need._id ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </div>
                  </div>

                  {expandedTask === need._id && (
                    <div className="px-6 pb-6 pt-2 space-y-6 animate-in slide-in-from-top-2 duration-200">
                      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
                        <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">{need.description}</p>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-6 text-xs font-bold text-slate-400">
                        <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-blue-500" /> {need.locationName || 'Kalyan District'}</span>
                        <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-indigo-500" /> Posted {new Date(need.createdAt).toLocaleDateString()}</span>
                        {need.requiredSkills?.length > 0 && (
                          <span className="flex items-center gap-2">
                            <GraduationCap className="h-3.5 w-3.5 text-purple-500" />
                            {need.requiredSkills.join(', ')}
                          </span>
                        )}
                      </div>

                      <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                        {need.status === 'assigned' && need.assignedVolunteer?._id === profile?._id ? (
                          <Button
                            onClick={(e) => { e.stopPropagation(); setCompletingTask(need); }}
                            className="w-full h-12 rounded-2xl font-black text-sm shadow-lg bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            Submit Task Completion
                          </Button>
                        ) : (
                          <Button
                            onClick={(e) => { e.stopPropagation(); joinTaskMutation.mutate(need._id); }}
                            disabled={joinTaskMutation.isPending || need.status === 'assigned' || need.status === 'completed'}
                            className={`w-full h-12 rounded-2xl font-black text-sm shadow-lg ${
                              need.status === 'assigned' ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 
                              need.status === 'completed' ? 'bg-blue-50 text-blue-400 cursor-not-allowed' : 'bg-slate-900 hover:bg-slate-800 text-white'
                            }`}
                          >
                            {joinTaskMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> :
                             need.status === 'assigned' ? 'Already Assigned' :
                             need.status === 'completed' ? 'Task Completed' : 'Join this Task'}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          
          {/* Completion Modal */}
          {completingTask && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-900 rounded-[2rem] p-8 max-w-lg w-full shadow-2xl relative max-h-[90vh] overflow-y-auto">
                <h3 className="text-xl font-black mb-2">Complete Task</h3>
                <p className="text-sm text-slate-500 mb-6">Submit final details for: {completingTask.title}</p>
                
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1 block">Number of People Helped</label>
                    <Input 
                      type="number"
                      placeholder="e.g. 50"
                      className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium"
                      value={numberOfPeople}
                      onChange={(e) => setNumberOfPeople(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1 block">Task Notes / Details</label>
                    <textarea
                      placeholder="Describe the work you completed..."
                      className="w-full h-24 p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border-none resize-none font-medium text-sm"
                      value={completionDetails}
                      onChange={(e) => setCompletionDetails(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className={`relative flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${completionFile ? 'border-emerald-400 bg-emerald-50/30' : 'border-slate-200 hover:border-emerald-400 hover:bg-slate-50'}`}
                         onClick={() => document.getElementById('proof-upload')?.click()}>
                      <Upload className={`h-8 w-8 mb-2 ${completionFile ? 'text-emerald-500' : 'text-slate-400'}`} />
                      <p className="text-xs font-bold text-center text-slate-600 line-clamp-2">{completionFile ? completionFile.name : 'Upload Work Proof*'}</p>
                      <input id="proof-upload" type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && setCompletionFile(e.target.files[0])} />
                    </div>
                    <div className={`relative flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${departmentLetterFile ? 'border-blue-400 bg-blue-50/30' : 'border-slate-200 hover:border-blue-400 hover:bg-slate-50'}`}
                         onClick={() => document.getElementById('letter-upload')?.click()}>
                      <FileCheck className={`h-8 w-8 mb-2 ${departmentLetterFile ? 'text-blue-500' : 'text-slate-400'}`} />
                      <p className="text-xs font-bold text-center text-slate-600 line-clamp-2">{departmentLetterFile ? departmentLetterFile.name : 'Dept Head Letter (Optional)'}</p>
                      <input id="letter-upload" type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && setDepartmentLetterFile(e.target.files[0])} />
                    </div>
                  </div>
                  <div className="flex gap-3 pt-4">
                    <Button variant="outline" className="flex-1 rounded-xl font-bold h-12" onClick={() => setCompletingTask(null)}>Cancel</Button>
                    <Button 
                      className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-12"
                      disabled={!completionFile || completeTaskMutation.isPending}
                      onClick={() => completionFile && completeTaskMutation.mutate({ 
                        needId: completingTask._id, 
                        proof: completionFile, 
                        letter: departmentLetterFile,
                        details: completionDetails,
                        people: numberOfPeople
                      })}
                    >
                      {completeTaskMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Submit Completion'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="max-w-4xl space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-black text-slate-900 dark:text-white">Volunteer Profile</h2>
              <p className="text-slate-500 font-medium">Keep your credentials and skills updated for better matching.</p>
            </div>
            <div className="bg-blue-600 p-4 rounded-3xl shadow-xl shadow-blue-200 dark:shadow-none">
              <Settings className="h-6 w-6 text-white" />
            </div>
          </div>

          {/* Profile Details Display */}
          {loadingProfile ? (
            <Card className="rounded-[2.5rem] border-none shadow-2xl bg-white dark:bg-slate-900 p-12 space-y-6">
              <Skeleton className="h-8 w-1/3" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" />
            </Card>
          ) : (
            <>
              {/* Current Info Card */}
              <Card className="rounded-[2.5rem] border-none shadow-xl bg-white dark:bg-slate-900 p-8">
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-6">Current Profile</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div><p className="text-[10px] font-black uppercase text-slate-400">Email</p><p className="font-bold text-sm">{profile?.email}</p></div>
                  <div><p className="text-[10px] font-black uppercase text-slate-400">Name</p><p className="font-bold text-sm">{profile?.fullName || '—'}</p></div>
                  <div><p className="text-[10px] font-black uppercase text-slate-400">Role</p><p className="font-bold text-sm capitalize">{profile?.role}</p></div>
                  <div><p className="text-[10px] font-black uppercase text-slate-400">Status</p>
                    <p className={`font-bold text-sm ${profile?.isVerified ? 'text-emerald-600' : 'text-orange-500'}`}>
                      {profile?.isVerified ? '✓ Verified' : '⏳ Pending'}
                    </p>
                  </div>
                  <div><p className="text-[10px] font-black uppercase text-slate-400">Skills</p><p className="font-bold text-sm">{profile?.skills?.join(', ') || '—'}</p></div>
                  <div><p className="text-[10px] font-black uppercase text-slate-400">Phone</p><p className="font-bold text-sm">{profile?.phone || '—'}</p></div>
                  <div><p className="text-[10px] font-black uppercase text-slate-400">Address</p><p className="font-bold text-sm">{profile?.address || '—'}</p></div>
                  <div><p className="text-[10px] font-black uppercase text-slate-400">Available</p><p className="font-bold text-sm">{profile?.isAvailable ? '✓ Yes' : '✗ Busy'}</p></div>
                </div>
              </Card>

              {/* Edit Profile Form */}
              <Card className="rounded-[2.5rem] border-none shadow-2xl overflow-hidden bg-white dark:bg-slate-900">
                <form onSubmit={handleUpdate} className="p-8 md:p-12 space-y-10">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-6">
                      <h3 className="text-sm font-black uppercase tracking-widest text-blue-600 flex items-center gap-2">
                        <User className="h-4 w-4" /> Personal Details
                      </h3>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">Full Name</label>
                          <Input name="fullName" defaultValue={profile?.fullName} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium" />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1"><Phone className="h-3 w-3 inline mr-1" />Contact Phone</label>
                          <Input name="phone" defaultValue={profile?.phone} placeholder="+91 00000 00000" className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium" />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1"><Home className="h-3 w-3 inline mr-1" />Address</label>
                          <Input name="address" defaultValue={profile?.address} placeholder="Kalyan, Maharashtra" className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium" />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-6">
                      <h3 className="text-sm font-black uppercase tracking-widest text-blue-600 flex items-center gap-2">
                        <GraduationCap className="h-4 w-4" /> Qualifications & Skills
                      </h3>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">Educational Qualifications</label>
                          <Input name="qualifications" defaultValue={profile?.qualifications} placeholder="e.g. B.Tech CS" className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium" />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1"><Briefcase className="h-3 w-3 inline mr-1" />Skills (comma separated)</label>
                          <Input name="skills" defaultValue={profile?.skills?.join(', ')} placeholder="First Aid, Translation, Driving" className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium" />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">Availability</label>
                          <select name="availability" defaultValue={profile?.availability || 'Weekends Only'} className="w-full h-12 px-4 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium text-sm outline-none focus:ring-2 focus:ring-blue-600">
                            <option value="Weekends Only">Weekends Only</option>
                            <option value="Weekdays Only">Weekdays Only</option>
                            <option value="Full Time">Full Time</option>
                            <option value="Emergency Only">Emergency Only</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="pt-6 border-t border-slate-50 dark:border-slate-800 flex justify-end">
                    <Button type="submit" disabled={updateProfileMutation.isPending}
                      className="h-14 px-10 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black text-lg shadow-xl shadow-blue-100 dark:shadow-none transition-all active:scale-95">
                      {updateProfileMutation.isPending ? <Loader2 className="h-6 w-6 animate-spin" /> : 'Save Profile'}
                    </Button>
                  </div>
                </form>
              </Card>

              {/* Location & Security */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Card className="rounded-[2.5rem] border-none shadow-xl bg-white dark:bg-slate-900 p-8 space-y-4">
                  <h3 className="text-sm font-black uppercase tracking-widest text-blue-600 flex items-center gap-2">
                    <Navigation className="h-4 w-4" /> Update Location
                  </h3>
                  {profile?.address ? (
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/30 space-y-2">
                      <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest">Active Address</p>
                      <p className="text-sm text-blue-700 dark:text-blue-300 font-bold leading-relaxed">{profile.address}</p>
                      {profile?.currentLocation?.coordinates?.length === 2 && (
                        <p className="text-[10px] text-blue-400 font-medium italic">
                          GPS: {profile.currentLocation.coordinates[1].toFixed(4)}°N, {profile.currentLocation.coordinates[0].toFixed(4)}°E
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 leading-relaxed italic">
                      Share your current GPS location so we can match you to the nearest tasks and update your profile automatically.
                    </p>
                  )}
                  <Button onClick={handleDetectLocation} disabled={updateLocationMutation.isPending}
                    className="w-full h-12 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black transition-all active:scale-[0.98]">
                    {updateLocationMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <><MapPin className="mr-2 h-5 w-5" />Detect My Location</>}
                  </Button>
                </Card>

                <Card className="rounded-[2.5rem] border-none shadow-xl bg-white dark:bg-slate-900 p-8 space-y-4">
                  <h3 className="text-sm font-black uppercase tracking-widest text-blue-600 flex items-center gap-2">
                    <Lock className="h-4 w-4" /> Security
                  </h3>
                  {showPasswordModal ? (
                    <div className="space-y-4">
                      <Input type="password" placeholder="Current Password" value={passwords.currentPassword}
                        onChange={e => setPasswords(p => ({ ...p, currentPassword: e.target.value }))}
                        className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium" />
                      <Input type="password" placeholder="New Password (min 6 chars)" value={passwords.newPassword}
                        onChange={e => setPasswords(p => ({ ...p, newPassword: e.target.value }))}
                        className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium" />
                      <div className="flex gap-3">
                        <Button onClick={() => setShowPasswordModal(false)} variant="outline" className="flex-1 rounded-xl font-bold">Cancel</Button>
                        <Button onClick={() => changePasswordMutation.mutate(passwords)}
                          disabled={changePasswordMutation.isPending}
                          className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold">
                          {changePasswordMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Save'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button onClick={() => setShowPasswordModal(true)} variant="outline" className="w-full h-12 rounded-2xl font-bold">
                      Change Password
                    </Button>
                  )}
                </Card>
              </div>

              {/* Document Verification */}
              <Card className="rounded-[2.5rem] border-none shadow-2xl overflow-hidden bg-white dark:bg-slate-900">
                <div className="p-8 md:p-12 space-y-6">
                  <h3 className="text-sm font-black uppercase tracking-widest text-emerald-600 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" /> AI Document Verification
                  </h3>
                  <p className="text-sm text-slate-500">Upload your Aadhaar, Voter ID, Medical License, or professional certificate. Our Gemini AI will verify and auto-detect your skills.</p>
                  {profile?.isVerified ? (
                    <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl border border-emerald-100 dark:border-emerald-800">
                      <FileCheck className="h-6 w-6 text-emerald-600" />
                      <div>
                        <p className="font-black text-emerald-700 dark:text-emerald-400">Identity Verified</p>
                        <p className="text-xs text-emerald-600/70">You are eligible for task assignments.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className={`relative group cursor-pointer border-2 border-dashed rounded-3xl transition-all flex flex-col items-center justify-center min-h-[160px] ${
                        verifyFile ? 'border-emerald-400 bg-emerald-50/30' : 'border-slate-200 hover:border-emerald-400 hover:bg-slate-50'
                      }`} onClick={() => document.getElementById('verify-upload')?.click()}>
                        <div className="flex flex-col items-center gap-3 p-6 text-center">
                          <div className="bg-emerald-100 p-4 rounded-2xl text-emerald-600 group-hover:scale-110 transition-transform"><Upload className="h-8 w-8" /></div>
                          <div className="font-bold text-slate-700 dark:text-slate-300">{verifyFile ? verifyFile.name : 'Upload Identity Document'}</div>
                          <p className="text-xs text-slate-500 max-w-[250px]">Aadhaar Card, Voter ID, Medical License (JPEG/PNG)</p>
                        </div>
                        <input id="verify-upload" type="file" className="hidden" accept="image/*,.pdf"
                          onChange={(e) => e.target.files?.[0] && setVerifyFile(e.target.files[0])} />
                      </div>
                      {verifyFile && (
                        <Button onClick={() => verifyMutation.mutate(verifyFile)} disabled={verifyMutation.isPending}
                          className="w-full h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-lg shadow-xl">
                          {verifyMutation.isPending ? <><Loader2 className="mr-2 h-6 w-6 animate-spin" /> Analyzing with Gemini AI...</> : <><ShieldCheck className="mr-2 h-6 w-6" /> Verify with AI OCR</>}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
