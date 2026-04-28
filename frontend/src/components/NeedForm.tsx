import React, { useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Button } from './ui/button.tsx';
import { Input } from './ui/input.tsx';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card.tsx';
import { Loader2, Upload, MapPin, AlertCircle, Sparkles } from 'lucide-react';

interface NeedFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function NeedForm({ onSuccess, onCancel }: NeedFormProps) {
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    urgency: 'medium',
    locationName: 'Kalyan District',
    location: {
      type: 'Point',
      coordinates: [73.1363, 19.2403] // Default to Kalyan
    }
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
          const address = response.data.display_name.split(',').slice(0, 2).join(',');
          setFormData(prev => ({
            ...prev,
            locationName: address,
            location: { type: 'Point', coordinates: [longitude, latitude] }
          }));
          toast.success('Location detected!');
        } catch (error) {
          setFormData(prev => ({
            ...prev,
            location: { type: 'Point', coordinates: [longitude, latitude] }
          }));
          toast.success('Coordinates detected!');
        }
      },
      () => toast.error('Unable to retrieve location.')
    );
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImage(file);
      setPreview(URL.createObjectURL(file));
      // Proactively offer AI analysis
    }
  };

  const analyzeWithAI = async () => {
    if (!image) return;
    setAnalyzing(true);
    const data = new FormData();
    data.append('file', image);

    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${import.meta.env.VITE_API_URL}/needs/analyze`, data, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const { analysis } = res.data;
      
      setFormData(prev => ({
        ...prev,
        title: analysis.title || prev.title,
        description: analysis.description || prev.description,
        urgency: analysis.urgency || prev.urgency,
        locationName: analysis.detectedArea || prev.locationName,
        ...(analysis.coordinates && {
          location: {
            type: 'Point',
            coordinates: [analysis.coordinates.lng, analysis.coordinates.lat]
          }
        })
      }));
      
      const areaName = analysis.detectedArea || 'Kalyan District';
      const skills = analysis.requiredSkills?.join(', ') || '';
      toast.success(`AI Analysis complete! Area: ${areaName}${skills ? ` | Skills: ${skills}` : ''}`);
    } catch (error) {
      toast.error('AI Analysis failed. Please fill manually.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const data = new FormData();
      data.append('title', formData.title);
      data.append('description', formData.description);
      data.append('urgency', formData.urgency);
      data.append('locationName', formData.locationName);
      data.append('longitude', formData.location.coordinates[0].toString());
      data.append('latitude', formData.location.coordinates[1].toString());
      if (image) data.append('file', image);

      await axios.post(`${import.meta.env.VITE_API_URL}/needs`, data);
      toast.success('Need posted successfully!');
      if (onSuccess) onSuccess();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to post need');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-none shadow-2xl bg-white dark:bg-slate-900 rounded-3xl overflow-hidden animate-in fade-in zoom-in duration-300">
      <CardHeader className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-8">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-3xl font-black tracking-tight">Identify Need</CardTitle>
            <p className="text-purple-100 mt-1 font-medium">Capture survey data for AI-powered matching.</p>
          </div>
          <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-md">
            <AlertCircle className="h-6 w-6 text-white" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              {/* Image Upload Area */}
              <div 
                className={`relative group cursor-pointer border-2 border-dashed rounded-3xl transition-all flex flex-col items-center justify-center min-h-[240px] ${
                  preview ? 'border-purple-400 bg-purple-50/30' : 'border-slate-200 hover:border-purple-400 hover:bg-slate-50'
                }`}
                onClick={() => document.getElementById('image-upload')?.click()}
              >
                {preview ? (
                  <img src={preview} alt="Preview" className="absolute inset-0 w-full h-full object-cover rounded-3xl opacity-40 group-hover:opacity-20 transition-opacity" />
                ) : null}
                
                <div className="relative z-10 flex flex-col items-center gap-3 p-6 text-center">
                  <div className="bg-purple-100 p-4 rounded-2xl text-purple-600 group-hover:scale-110 transition-transform">
                    <Upload className="h-8 w-8" />
                  </div>
                  <div className="font-bold text-slate-700 dark:text-slate-200">
                    {image ? image.name : 'Upload Humanitarian Survey'}
                  </div>
                  <p className="text-xs text-slate-500 max-w-[200px]">Drag and drop or click to upload an image of the survey site or document.</p>
                </div>
                <input id="image-upload" type="file" className="hidden" onChange={handleImageChange} accept="image/*" />
              </div>

              {image && (
                <Button 
                  type="button" 
                  onClick={analyzeWithAI} 
                  disabled={analyzing}
                  className="w-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 rounded-2xl h-12 font-black border border-indigo-100 dark:border-indigo-800 shadow-sm"
                >
                  {analyzing ? (
                    <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Analyzing with Gemini AI...</>
                  ) : (
                    <><Sparkles className="mr-2 h-5 w-5" /> Analyze with Gemini AI</>
                  )}
                </Button>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2 block">Need Title</label>
                <Input 
                  placeholder="e.g. Urgent Water Supply Shortage" 
                  className="rounded-2xl h-12 border-slate-200 focus:ring-purple-600 dark:bg-slate-800 dark:text-white dark:border-slate-700"
                  value={formData.title}
                  onChange={e => setFormData({...formData, title: e.target.value})}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2 block">Description</label>
                <textarea 
                  placeholder="Describe the situation and requirements..." 
                  className="w-full rounded-2xl p-4 border border-slate-200 focus:ring-2 focus:ring-purple-600 outline-none min-h-[120px] text-sm dark:bg-slate-800 dark:text-white dark:border-slate-700"
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2 block">Urgency</label>
                  <select 
                    className="w-full h-12 rounded-2xl px-4 border border-slate-200 focus:ring-2 focus:ring-purple-600 outline-none bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-bold text-sm"
                    value={formData.urgency}
                    onChange={e => setFormData({...formData, urgency: e.target.value})}
                  >
                    <option value="low" className="text-slate-900 dark:bg-slate-800 dark:text-white">Low Priority</option>
                    <option value="medium" className="text-slate-900 dark:bg-slate-800 dark:text-white">Medium Priority</option>
                    <option value="high" className="text-slate-900 dark:bg-slate-800 dark:text-white">High Priority</option>
                    <option value="critical" className="text-slate-900 dark:bg-slate-800 dark:text-white">Critical (Immediate)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2 block">Location</label>
                  <div className="relative group">
                    <Input 
                      placeholder="Enter location manually or detect..." 
                      className="rounded-2xl h-12 pl-10 pr-12 border-slate-200 focus:ring-purple-600 dark:bg-slate-800 dark:text-white dark:border-slate-700"
                      value={formData.locationName}
                      onChange={e => setFormData({...formData, locationName: e.target.value})}
                      required
                    />
                    <MapPin className="absolute left-3.5 top-3.5 h-5 w-5 text-purple-500" />
                    <button 
                      type="button"
                      onClick={handleDetectLocation}
                      title="Detect current location"
                      className="absolute right-2 top-1.5 h-9 w-9 flex items-center justify-center bg-purple-100 dark:bg-purple-900/30 text-purple-600 rounded-xl hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
                    >
                      <Sparkles className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-4 pt-4">
            <Button 
              type="button" 
              variant="ghost" 
              onClick={onCancel}
              className="flex-1 rounded-2xl h-14 font-bold text-slate-500"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={loading}
              className="flex-[2] rounded-2xl h-14 font-black text-lg bg-purple-600 hover:bg-purple-700 shadow-xl shadow-purple-200 dark:shadow-none"
            >
              {loading ? (
                <><Loader2 className="mr-2 h-6 w-6 animate-spin" /> Posting...</>
              ) : (
                'Publish Need'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
