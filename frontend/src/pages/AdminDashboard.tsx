import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { toast } from 'sonner';
import { useState } from 'react';
import { 
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer 
} from 'recharts';
import { Users, Building2, LayoutDashboard, Download, CheckCircle2, XCircle, Search, ArrowUpRight, Settings, Lock, MapPin, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '../components/ui/input.tsx';

// Setup axios instance matching the old 'api' import
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL
});

// Add interceptor to include token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

import UrgencyHeatMap from '../components/UrgencyHeatMap.tsx';

export default function AdminDashboard() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  // Fetch Real Stats
  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get('/admin/dashboard/stats').then(res => res.data),
  });

  // Fetch All Needs
  const { data: needs } = useQuery({
    queryKey: ['admin-needs'],
    queryFn: () => api.get('/needs').then(res => res.data),
  });

  // Fetch Users
  const { data: userData, isLoading } = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () => api.get('/admin/users', { params: { search } }).then(res => res.data),
  });

  // Mutation for Verifying Users
  const verifyMutation = useMutation({
    mutationFn: ({ id, verified }: { id: string; verified: boolean }) => 
      api.patch(`/admin/users/${id}/verify`, { verified }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User status updated');
    },
    onError: () => toast.error('Failed to update user status')
  });

  const exportToCSV = () => {
    if (!userData) return;
    // Assuming backend returns an array directly now or an object with items
    const items = Array.isArray(userData) ? userData : (userData.items || []);
    if (items.length === 0) return;

    const headers = ['Email', 'Role', 'Status'];
    const rows = items.map((u: any) => [u.email, u.role, u.isVerified ? 'Verified' : 'Pending']);
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "impactmatch_users.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const users = Array.isArray(userData) ? userData : (userData?.items || []);

  const roleData = [
    { name: 'NGOs', value: users.filter((u: any) => u.role === 'ngo').length },
    { name: 'Volunteers', value: users.filter((u: any) => u.role === 'volunteer').length },
    { name: 'Admins', value: users.filter((u: any) => u.role === 'admin').length },
  ].filter(d => d.value > 0);

  const COLORS = ['#6366f1', '#10b981', '#3b82f6'];

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight italic">Admin <span className="text-indigo-600">Control Center</span></h1>
          <p className="text-muted-foreground font-medium">Global overview and system management for Kalyān regional network.</p>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
           <Button variant="outline" onClick={exportToCSV} className="rounded-xl font-bold border-indigo-100 h-12 flex-1 md:flex-none">
             <Download className="mr-2 h-4 w-4" /> Export CSV
           </Button>
           <Button onClick={() => setShowSettings(!showSettings)} className="bg-indigo-600 hover:bg-indigo-700 h-12 px-8 rounded-xl font-bold flex-1 md:flex-none">
             <Settings className="mr-2 h-4 w-4" /> {showSettings ? 'Back to Dashboard' : 'System Settings'}
           </Button>
        </div>
      </header>

      {showSettings ? (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="rounded-[2rem] border-none shadow-xl p-8 space-y-4">
              <h3 className="text-lg font-black flex items-center gap-2"><Users className="h-5 w-5 text-indigo-600" /> Admin Account</h3>
              <div className="space-y-3">
                <div><p className="text-[10px] font-black uppercase text-slate-400">Email</p><p className="font-bold text-sm">mdibransiddique02@gmail.com</p></div>
                <div><p className="text-[10px] font-black uppercase text-slate-400">Role</p><p className="font-bold text-sm">System Administrator</p></div>
                <div><p className="text-[10px] font-black uppercase text-slate-400">Network</p><p className="font-bold text-sm">{stats?.totalUsers || 0} users across Kalyān region</p></div>
              </div>
            </Card>
            <Card className="rounded-[2rem] border-none shadow-xl p-8 space-y-4">
              <h3 className="text-lg font-black flex items-center gap-2"><Lock className="h-5 w-5 text-indigo-600" /> Change Password</h3>
              {showPasswordForm ? (
                <div className="space-y-4">
                  <Input type="password" placeholder="Current Password" value={passwords.currentPassword}
                    onChange={e => setPasswords(p => ({ ...p, currentPassword: e.target.value }))}
                    className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium" />
                  <Input type="password" placeholder="New Password (min 6 chars)" value={passwords.newPassword}
                    onChange={e => setPasswords(p => ({ ...p, newPassword: e.target.value }))}
                    className="h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border-none font-medium" />
                  <div className="flex gap-3">
                    <Button variant="outline" onClick={() => setShowPasswordForm(false)} className="flex-1 rounded-xl font-bold">Cancel</Button>
                    <Button onClick={async () => {
                      try {
                        await api.post('/users/change-password', passwords);
                        toast.success('Password changed!');
                        setShowPasswordForm(false);
                        setPasswords({ currentPassword: '', newPassword: '' });
                      } catch (err: any) {
                        toast.error(err.response?.data?.message || 'Failed to change password.');
                      }
                    }} className="flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold">Save</Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" onClick={() => setShowPasswordForm(true)} className="w-full rounded-xl font-bold">Change Password</Button>
              )}
            </Card>
            <Card className="rounded-[2rem] border-none shadow-xl p-8 space-y-4 md:col-span-2">
              <h3 className="text-lg font-black flex items-center gap-2"><LayoutDashboard className="h-5 w-5 text-indigo-600" /> System Status</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div><p className="text-[10px] font-black uppercase text-slate-400">Matching Engine</p><p className="font-bold text-sm text-emerald-600">✓ Active (5min cycle)</p></div>
                <div><p className="text-[10px] font-black uppercase text-slate-400">AI Verification</p><p className="font-bold text-sm text-emerald-600">✓ Gemini Connected</p></div>
                <div><p className="text-[10px] font-black uppercase text-slate-400">Heatmap</p><p className="font-bold text-sm text-emerald-600">✓ Live</p></div>
                <div><p className="text-[10px] font-black uppercase text-slate-400">Database</p><p className="font-bold text-sm text-emerald-600">✓ MongoDB Atlas</p></div>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <>

      {/* Analytics & Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-6 border-none shadow-xl bg-indigo-600 text-white rounded-[2rem]">
            <div className="flex justify-between items-start">
              <Users className="h-8 w-8 opacity-20" />
              <div className="bg-white/20 p-1 rounded-lg"><ArrowUpRight className="h-4 w-4" /></div>
            </div>
            <p className="text-sm font-bold opacity-80 mt-4 uppercase tracking-widest">Total Network</p>
            <p className="text-4xl font-black">{stats?.totalUsers || 0}</p>
          </Card>
          <Card className="p-6 border-none shadow-xl bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800">
            <Building2 className="h-8 w-8 text-emerald-600 mb-4" />
            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Pending NGOs</p>
            <p className="text-4xl font-black">{stats?.pendingNGOs || 0}</p>
          </Card>
          <Card className="p-6 border-none shadow-xl bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800">
            <LayoutDashboard className="h-8 w-8 text-blue-600 mb-4" />
            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Active Needs</p>
            <p className="text-4xl font-black">{stats?.totalNeeds || 0}</p>
          </Card>
        </div>

        <Card className="p-6 bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-xl overflow-hidden relative">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Role Distribution</h3>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={roleData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {roleData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-2">
             {roleData.map((entry, index) => (
               <div key={entry.name} className="flex items-center gap-1.5">
                 <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                 <span className="text-[10px] font-bold uppercase text-slate-500">{entry.name}</span>
               </div>
             ))}
          </div>
        </Card>
      </div>

      {/* Heatmap Section */}
      <Card className="p-8 bg-white dark:bg-slate-900 rounded-[3rem] border-none shadow-2xl overflow-hidden relative group">
        <div className="absolute top-0 left-0 w-2 h-full bg-red-500 opacity-20 group-hover:opacity-100 transition-opacity" />
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-white">Regional Urgency <span className="text-red-500">Heatmap</span></h2>
            <p className="text-slate-500 font-medium italic">Visualizing "hotspots" based on real-time urgency scores from the field.</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-800">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-black uppercase tracking-widest text-red-600">Live Analysis</span>
          </div>
        </div>
        <UrgencyHeatMap tasks={stats?.heatmapData || []} />
      </Card>

      <Card className="shadow-lg border-none ring-1 ring-slate-200 dark:ring-slate-800">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>User Management</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search by email..." 
              className="pl-8" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/50 dark:bg-slate-900/50">
                  <TableHead>User Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Verification Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                      No users found matching your search.
                    </TableCell>
                  </TableRow>
                ) : users.map((user: any) => (
                  <TableRow key={user._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors">
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize px-3 py-0.5 rounded-full font-semibold">
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.isVerified ? (
                        <div className="flex items-center text-green-600 gap-1.5">
                          <CheckCircle2 className="h-4 w-4" />
                          <span className="text-sm font-medium">Verified</span>
                        </div>
                      ) : (
                        <div className="flex items-center text-orange-500 gap-1.5">
                          <XCircle className="h-4 w-4" />
                          <span className="text-sm font-medium">Pending</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => verifyMutation.mutate({ id: user._id, verified: !user.isVerified })}
                        className={user.isVerified ? 'text-red-500 hover:text-red-600' : 'text-blue-600 hover:text-blue-700'}
                      >
                        {user.isVerified ? 'Revoke Access' : 'Verify NGO'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* All Tasks Section */}
      <Card className="shadow-lg border-none ring-1 ring-slate-200 dark:ring-slate-800 p-6 md:p-8 rounded-[2rem]">
        <h3 className="text-xl font-black mb-6">Global Tasks & Proofs</h3>
        {needs?.length === 0 ? (
          <p className="text-center py-10 text-slate-400 font-bold italic">No tasks on the platform yet.</p>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-800">
            {needs?.map((need: any) => (
              <div 
                key={need._id} 
                className="py-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all flex flex-col justify-center group rounded-2xl px-4 cursor-pointer"
                onClick={() => setExpandedTask(expandedTask === need._id ? null : need._id)}
              >
                <div className="flex justify-between items-center w-full">
                  <div className="flex items-center gap-3">
                    <h4 className="text-lg font-black group-hover:text-indigo-600 transition-colors">{need.title}</h4>
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
      </Card>
      </>
      )}
    </div>
  );
}
