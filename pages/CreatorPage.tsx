import React, { useState, useEffect, useRef } from 'react';
import { User, Tour, TourStop, MediaType, GeoPoint } from '../types';
import { storageService } from '../services/storageService';
import TourMap from '../components/TourMap';
import { generateStopDetailsJSON } from '../services/geminiService';
import { DEFAULT_COORDS } from '../constants';

interface CreatorPageProps {
  user: User;
}

const CreatorPage: React.FC<CreatorPageProps> = ({ user }) => {
  const [tours, setTours] = useState<Tour[]>([]);
  const [editingTour, setEditingTour] = useState<Tour | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [uploadingState, setUploadingState] = useState<{[key: number]: boolean}>({});
  const [coverUploading, setCoverUploading] = useState(false);
  const [userLocation, setUserLocation] = useState<GeoPoint | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // Load user's tours
  useEffect(() => {
    loadTours();
  }, []);

  // Track Location Logic
  const startLocationTracking = (highAccuracy = true) => {
    if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
    }

    if (!navigator.geolocation) {
      setGeoError("Geolocation not supported");
      return;
    }

    setGeoError(null);
    const options = {
        enableHighAccuracy: highAccuracy,
        timeout: 10000,
        maximumAge: 5000
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoError(null);
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        });
      },
      (err) => {
        console.warn("Geo error:", err);
        let msg = "Location unavailable";
        if (err.code === 1) msg = "Permission denied";
        else if (err.code === 2) msg = "Signal unavailable";
        else if (err.code === 3) msg = "Timeout";
        setGeoError(msg);
      },
      options
    );
  };

  // Initial tracking attempt on mount
  useEffect(() => {
    startLocationTracking(true);
    return () => {
        if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
        }
    };
  }, []);

  const handleRetryLocation = () => {
      // User gesture allows for permission prompt
      setGeoError("Requesting permission...");
      navigator.geolocation.getCurrentPosition(
          (pos) => {
              // If successful, start watching with high accuracy
              setUserLocation({
                  lat: pos.coords.latitude,
                  lng: pos.coords.longitude
              });
              startLocationTracking(true);
          },
          (err) => {
              console.warn("Retry failed, trying low accuracy", err);
              // Fallback to low accuracy if high failed
              startLocationTracking(false);
          },
          { enableHighAccuracy: true, timeout: 5000 }
      );
  };

  const loadTours = async () => {
    const allTours = await storageService.getTours();
    setTours(allTours.filter(t => t.authorId === user.id));
  };

  const handleCreateNew = () => {
    const newTour: Tour = {
      id: `tour-${Date.now()}`,
      title: 'Untitled Tour',
      description: '',
      authorId: user.id,
      stops: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setEditingTour(newTour);
  };

  const handleSave = async () => {
    if (editingTour) {
      await storageService.saveTour(editingTour);
      setEditingTour(null);
      loadTours();
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this tour?")) {
      await storageService.deleteTour(id);
      loadTours();
    }
  };

  const handleCoverFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        setCoverUploading(true);
        try {
            const url = await storageService.uploadMedia(file);
            setEditingTour(prev => prev ? { ...prev, coverUrl: url } : null);
        } catch (error) {
            alert("Failed to upload cover image. Please try again.");
            console.error(error);
        } finally {
            setCoverUploading(false);
        }
    }
  };

  // --- Stop Management ---

  const addStop = () => {
    setEditingTour(prev => {
      if (!prev) return null;
      const initialLocation = userLocation ? { ...userLocation } : { ...DEFAULT_COORDS };
      
      const newStop: TourStop = {
        id: `stop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title: 'New Stop',
        description: '',
        location: initialLocation,
        mediaType: MediaType.NONE
      };
      return {
        ...prev,
        stops: [...prev.stops, newStop]
      };
    });
  };

  const updateStop = (index: number, updates: Partial<TourStop>) => {
    setEditingTour(prev => {
      if (!prev) return null;
      const updatedStops = [...prev.stops];
      updatedStops[index] = { ...updatedStops[index], ...updates };
      return { ...prev, stops: updatedStops };
    });
  };

  const removeStop = (index: number) => {
    setEditingTour(prev => {
      if (!prev) return null;
      const updatedStops = prev.stops.filter((_, i) => i !== index);
      return { ...prev, stops: updatedStops };
    });
  };

  const handleMagicFill = async (index: number) => {
    if (!editingTour) return;
    const stop = editingTour.stops[index];
    if (!stop.title || stop.title === 'New Stop') {
      alert("Please enter a valid place name first.");
      return;
    }

    setIsGenerating(true);
    try {
        const details = await generateStopDetailsJSON(stop.title);
        updateStop(index, {
            description: details.description,
            location: { lat: details.lat, lng: details.lng }
        });
    } finally {
        setIsGenerating(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = e.target.files?.[0];
    if (file) {
        setUploadingState(prev => ({...prev, [index]: true}));
        try {
            const url = await storageService.uploadMedia(file);
            updateStop(index, { mediaUrl: url });
        } catch (error) {
            alert("Failed to upload media. Please try again.");
            console.error(error);
        } finally {
            setUploadingState(prev => ({...prev, [index]: false}));
        }
    }
  };

  const setStopToCurrentLocation = (index: number) => {
    if (userLocation) {
        updateStop(index, { location: { ...userLocation } });
    } else {
        // Trigger a retry if they click this and location isn't ready
        handleRetryLocation();
    }
  };

  if (editingTour) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-3xl font-bold">Edit Tour</h2>
          <div className="space-x-4">
             <button onClick={() => setEditingTour(null)} className="text-gray-400 hover:text-white">Cancel</button>
             <button onClick={handleSave} className="bg-primary hover:bg-teal-600 px-6 py-2 rounded-md font-bold shadow-lg">Save Tour</button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column: Details */}
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4">
               
               {/* Title & Description */}
               <div>
                   <label className="block text-sm font-medium text-gray-400 mb-1">Tour Title</label>
                   <input 
                     type="text" 
                     className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white focus:ring-2 focus:ring-primary outline-none"
                     value={editingTour.title}
                     onChange={(e) => setEditingTour(prev => prev ? {...prev, title: e.target.value} : null)}
                   />
               </div>
               
               {/* Cover Image */}
               <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Cover Image</label>
                    {editingTour.coverUrl && (
                        <div className="relative mb-2 group">
                             <img src={editingTour.coverUrl} alt="Cover" className="h-40 w-full object-cover rounded-md border border-gray-700" />
                             <button 
                                onClick={() => setEditingTour(prev => prev ? {...prev, coverUrl: undefined} : null)}
                                className="absolute top-2 right-2 bg-red-600 text-white p-1 rounded hover:bg-red-500 opacity-0 group-hover:opacity-100 transition"
                                title="Remove Image"
                             >
                                 <i className="fa-solid fa-times"></i>
                             </button>
                        </div>
                    )}
                    <div className="flex space-x-2">
                        <input 
                            type="text" 
                            placeholder="Image URL..."
                            className="flex-1 bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white outline-none focus:ring-1 focus:ring-primary"
                            value={editingTour.coverUrl || ''}
                            onChange={(e) => setEditingTour(prev => prev ? {...prev, coverUrl: e.target.value} : null)}
                        />
                        <div className="relative">
                            <input
                                type="file"
                                accept="image/*"
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                onChange={handleCoverFileChange}
                                disabled={coverUploading}
                            />
                            <button className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded text-sm font-medium h-full flex items-center border border-gray-600">
                                {coverUploading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-upload mr-2"></i>} 
                                Upload
                            </button>
                        </div>
                    </div>
               </div>

               <div>
                   <label className="block text-sm font-medium text-gray-400 mb-1">Description</label>
                   <textarea 
                     className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white focus:ring-2 focus:ring-primary outline-none h-24"
                     value={editingTour.description}
                     onChange={(e) => setEditingTour(prev => prev ? {...prev, description: e.target.value} : null)}
                   />
               </div>
            </div>

            <div className="flex justify-between items-center">
                <h3 className="text-xl font-semibold">Stops ({editingTour.stops.length})</h3>
                <button onClick={addStop} className="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded">
                    <i className="fa-solid fa-plus mr-1"></i> Add Stop
                </button>
            </div>

            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
                {editingTour.stops.map((stop, idx) => (
                    <div key={stop.id} className="bg-gray-800 p-4 rounded-lg border border-gray-700 relative">
                        <button 
                            onClick={() => removeStop(idx)} 
                            className="absolute top-2 right-2 text-gray-500 hover:text-red-500"
                        >
                            <i className="fa-solid fa-trash"></i>
                        </button>
                        
                        <div className="grid grid-cols-1 gap-3">
                            <div>
                                <label className="text-xs text-gray-500 uppercase">Place Name</label>
                                <div className="flex space-x-2">
                                    <input 
                                        type="text" 
                                        className="flex-1 bg-gray-900 border border-gray-700 rounded p-2 text-sm"
                                        value={stop.title}
                                        onChange={(e) => updateStop(idx, { title: e.target.value })}
                                    />
                                    <button 
                                        onClick={() => handleMagicFill(idx)}
                                        disabled={isGenerating}
                                        className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-2 rounded text-xs font-bold flex items-center"
                                        title="Auto-fill description & coords with AI"
                                    >
                                        {isGenerating ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-wand-magic-sparkles"></i>}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-xs text-gray-500 uppercase">Lat</label>
                                        <input 
                                            type="number" step="0.0001"
                                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm"
                                            value={stop.location.lat}
                                            onChange={(e) => updateStop(idx, { location: { ...stop.location, lat: parseFloat(e.target.value) } })}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-500 uppercase">Lng</label>
                                        <input 
                                            type="number" step="0.0001"
                                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm"
                                            value={stop.location.lng}
                                            onChange={(e) => updateStop(idx, { location: { ...stop.location, lng: parseFloat(e.target.value) } })}
                                        />
                                    </div>
                                </div>
                                <button 
                                    onClick={() => setStopToCurrentLocation(idx)}
                                    className={`w-full mt-2 bg-gray-700 hover:bg-gray-600 text-xs text-gray-300 py-1 rounded flex items-center justify-center transition`}
                                    title={userLocation ? "Set to current GPS location" : `GPS Unavailable: ${geoError || "Locating..."}`}
                                >
                                    {userLocation ? <i className="fa-solid fa-location-crosshairs mr-1"></i> : <i className="fa-solid fa-spinner fa-spin mr-1"></i>}
                                    {userLocation ? "Use Current Location" : geoError ? "Retry GPS" : "Locating..."}
                                </button>
                                {geoError && !userLocation && <div className="text-xs text-red-400 mt-1 text-center">{geoError}</div>}
                            </div>

                            <div>
                                <label className="text-xs text-gray-500 uppercase">Description</label>
                                <textarea 
                                    className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm h-20"
                                    value={stop.description}
                                    onChange={(e) => updateStop(idx, { description: e.target.value })}
                                />
                            </div>

                            <div>
                                <label className="text-xs text-gray-500 uppercase block mb-1">Media Attachment</label>
                                <div className="flex flex-col space-y-2">
                                    <select
                                        value={stop.mediaType}
                                        onChange={(e) => updateStop(idx, { mediaType: e.target.value as MediaType })}
                                        className="bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white focus:ring-1 focus:ring-primary outline-none"
                                    >
                                        <option value={MediaType.NONE}>No Media</option>
                                        <option value={MediaType.IMAGE}>Image</option>
                                        <option value={MediaType.VIDEO}>Video</option>
                                        <option value={MediaType.AUDIO}>Audio</option>
                                    </select>

                                    {stop.mediaType !== MediaType.NONE && (
                                        <div className="space-y-2 border border-gray-700 p-3 rounded bg-gray-900/50">
                                             <input
                                                type="text"
                                                placeholder={`Paste ${stop.mediaType} URL...`}
                                                className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm focus:ring-1 focus:ring-primary outline-none"
                                                value={stop.mediaUrl || ''}
                                                onChange={(e) => updateStop(idx, { mediaUrl: e.target.value })}
                                             />
                                             <div className="flex items-center space-x-2">
                                                <span className="text-xs text-gray-400 whitespace-nowrap">OR Upload:</span>
                                                <input
                                                    type="file"
                                                    disabled={uploadingState[idx]}
                                                    accept={stop.mediaType === MediaType.IMAGE ? "image/*" : stop.mediaType === MediaType.VIDEO ? "video/*" : "audio/*"}
                                                    className="w-full text-xs text-gray-400 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-gray-700 file:text-white hover:file:bg-gray-600 cursor-pointer disabled:opacity-50"
                                                    onChange={(e) => handleFileChange(e, idx)}
                                                />
                                                {uploadingState[idx] && <i className="fa-solid fa-spinner fa-spin text-primary"></i>}
                                             </div>
                                             
                                             {stop.mediaUrl && !uploadingState[idx] && (
                                                 <div className="mt-2 p-1 bg-black rounded border border-gray-800 flex justify-center">
                                                    {stop.mediaType === MediaType.IMAGE && (
                                                        <img src={stop.mediaUrl} alt="Preview" className="h-32 w-auto max-w-full rounded object-contain" />
                                                    )}
                                                    {stop.mediaType === MediaType.VIDEO && (
                                                        <video src={stop.mediaUrl} controls className="h-32 w-auto max-w-full rounded" />
                                                    )}
                                                    {stop.mediaType === MediaType.AUDIO && (
                                                        <audio src={stop.mediaUrl} controls className="w-full" />
                                                    )}
                                                 </div>
                                             )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
          </div>

          {/* Right Column: Visualization */}
          <div className="sticky top-24">
             <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                 <h3 className="text-lg font-semibold mb-4 text-gray-300">Route Preview</h3>
                 <TourMap tour={editingTour} userLocation={userLocation} />
                 {geoError && (
                    <div className="mt-2 text-center flex items-center justify-center space-x-2">
                        <span className="text-xs text-red-400 bg-red-900/20 border border-red-800 px-2 py-1 rounded">
                            <i className="fa-solid fa-triangle-exclamation mr-1"></i> {geoError}
                        </span>
                        <button 
                            onClick={handleRetryLocation} 
                            className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded transition"
                        >
                            Retry GPS
                        </button>
                    </div>
                 )}
                 <p className="mt-4 text-sm text-gray-500 text-center">
                    Visual representation of your stops relative to each other.
                 </p>
             </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">My Tours</h1>
        <button 
          onClick={handleCreateNew}
          className="bg-primary hover:bg-teal-600 text-white px-5 py-2 rounded-lg font-medium flex items-center"
        >
          <i className="fa-solid fa-plus mr-2"></i> Create New Tour
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tours.map(tour => (
          <div key={tour.id} className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 hover:border-gray-500 transition shadow-lg flex flex-col">
             <div className="h-40 bg-gray-700 relative">
                {tour.coverUrl ? (
                    <img src={tour.coverUrl} alt={tour.title} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600">
                        <i className="fa-solid fa-map text-4xl"></i>
                    </div>
                )}
                <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 px-2 py-1 rounded text-xs text-white">
                    {tour.stops.length} Stops
                </div>
             </div>
             <div className="p-5 flex-grow flex flex-col">
                <h3 className="text-xl font-bold mb-1">{tour.title}</h3>
                <p className="text-gray-400 text-sm line-clamp-2 mb-4 flex-grow">{tour.description || "No description provided."}</p>
                <div className="flex justify-between items-center border-t border-gray-700 pt-4">
                    <span className="text-xs text-gray-500">Updated {new Date(tour.updatedAt).toLocaleDateString()}</span>
                    <div className="space-x-2">
                        <button onClick={() => setEditingTour(tour)} className="text-blue-400 hover:text-blue-300 text-sm font-medium">Edit</button>
                        <button onClick={() => handleDelete(tour.id)} className="text-red-400 hover:text-red-300 text-sm font-medium">Delete</button>
                    </div>
                </div>
             </div>
          </div>
        ))}
        
        {tours.length === 0 && (
            <div className="col-span-full text-center py-20 text-gray-500">
                You haven't created any tours yet. Click "Create New Tour" to start.
            </div>
        )}
      </div>
    </div>
  );
};

export default CreatorPage;