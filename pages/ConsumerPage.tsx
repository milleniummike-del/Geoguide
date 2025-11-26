import React, { useState, useEffect, useRef } from 'react';
import { Tour, GeoPoint, TourStop, MediaType } from '../types';
import { storageService } from '../services/storageService';
import TourMap from '../components/TourMap';
import { generateAudioGuide, playAudioBuffer } from '../services/geminiService';

const ConsumerPage: React.FC = () => {
  const [tours, setTours] = useState<Tour[]>([]);
  const [activeTour, setActiveTour] = useState<Tour | null>(null);
  const [activeStopId, setActiveStopId] = useState<string | undefined>(undefined);
  const [userLocation, setUserLocation] = useState<GeoPoint | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    storageService.getTours().then(setTours);
    startLocationTracking(true);

    return () => {
        if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
        }
    };
  }, []);

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
        let msg = "Locating failed";
        if (err.code === 1) msg = "Permission Denied";
        else if (err.code === 2) msg = "Unavailable";
        else if (err.code === 3) msg = "Timeout";
        setGeoError(msg);
      },
      options
    );
  };

  const handleRetryLocation = () => {
      setGeoError("Requesting permission...");
      navigator.geolocation.getCurrentPosition(
          (pos) => {
              setUserLocation({
                  lat: pos.coords.latitude,
                  lng: pos.coords.longitude
              });
              startLocationTracking(true);
          },
          (err) => {
              console.warn("Retry failed, using low accuracy", err);
              startLocationTracking(false);
          },
          { enableHighAccuracy: true, timeout: 5000 }
      );
  };

  const startTour = (tour: Tour) => {
    setActiveTour(tour);
    if (tour.stops.length > 0) {
      setActiveStopId(tour.stops[0].id);
    }
  };

  const handleStopClick = (id: string) => {
    setActiveStopId(id);
  };

  const playGuide = async (text: string) => {
    setAudioLoading(true);
    const buffer = await generateAudioGuide(text);
    if (buffer) {
        playAudioBuffer(buffer);
    }
    setAudioLoading(false);
  };

  if (activeTour) {
    const activeStop = activeTour.stops.find(s => s.id === activeStopId);
    
    return (
      <div className="flex flex-col h-[calc(100vh-100px)]">
        <div className="mb-4 flex items-center space-x-4">
             <button onClick={() => setActiveTour(null)} className="text-gray-400 hover:text-white">
                <i className="fa-solid fa-arrow-left"></i> Back
             </button>
             <h1 className="text-2xl font-bold truncate">{activeTour.title}</h1>
        </div>

        <div className="flex-grow grid grid-cols-1 lg:grid-cols-3 gap-6 h-full overflow-hidden">
            {/* Map View */}
            <div className="lg:col-span-2 bg-gray-800 rounded-xl overflow-hidden border border-gray-700 flex flex-col">
                <div className="flex-grow relative">
                    <TourMap 
                        tour={activeTour} 
                        activeStopId={activeStopId} 
                        userLocation={userLocation} 
                        onStopClick={handleStopClick}
                    />
                </div>
                <div className="p-4 bg-gray-900 border-t border-gray-700 flex justify-between items-center text-sm text-gray-400">
                    <span><i className="fa-solid fa-location-dot mr-1"></i> {activeTour.stops.length} Stops</span>
                    <div className="flex items-center space-x-2">
                        <span className={geoError ? "text-red-400 font-bold" : "text-gray-400"}>
                            <i className={`fa-solid ${geoError ? 'fa-circle-exclamation' : 'fa-person-walking'} mr-1`}></i> 
                            {userLocation ? "Location Active" : geoError || "Locating..."}
                        </span>
                        {geoError && (
                            <button onClick={handleRetryLocation} className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-white transition">
                                Retry
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Stop Details */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 flex flex-col overflow-hidden">
                <div className="p-4 border-b border-gray-700 bg-gray-750">
                    <h2 className="font-bold text-lg">Stop Guide</h2>
                </div>
                
                <div className="flex-grow overflow-y-auto p-6 space-y-6">
                    {activeStop ? (
                        <>
                            <div className="relative">
                                <h3 className="text-2xl font-bold mb-2 text-white">{activeStop.title}</h3>
                                {activeStop.mediaUrl && activeStop.mediaType !== MediaType.NONE && (
                                    <div className="mb-4">
                                        {activeStop.mediaType === MediaType.IMAGE && (
                                            <img src={activeStop.mediaUrl} alt={activeStop.title} className="w-full h-auto max-h-64 object-cover rounded-lg shadow-md" />
                                        )}
                                        {activeStop.mediaType === MediaType.VIDEO && (
                                            <video src={activeStop.mediaUrl} controls className="w-full rounded-lg shadow-md" />
                                        )}
                                        {activeStop.mediaType === MediaType.AUDIO && (
                                            <div className="bg-gray-900 p-4 rounded-lg">
                                                <div className="text-xs text-gray-400 mb-2 uppercase font-bold">Attached Audio</div>
                                                <audio src={activeStop.mediaUrl} controls className="w-full" />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            
                            <div className="prose prose-invert prose-sm">
                                <p>{activeStop.description || "No description available for this stop."}</p>
                            </div>

                            <button 
                                onClick={() => playGuide(activeStop.description || `Welcome to ${activeStop.title}.`)}
                                disabled={audioLoading}
                                className="w-full bg-accent hover:bg-amber-600 text-white py-3 rounded-lg font-bold flex items-center justify-center transition disabled:opacity-50"
                            >
                                {audioLoading ? (
                                    <><i className="fa-solid fa-spinner fa-spin mr-2"></i> Generating Audio...</>
                                ) : (
                                    <><i className="fa-solid fa-headphones mr-2"></i> Play Audio Guide</>
                                )}
                            </button>
                        </>
                    ) : (
                        <div className="text-center text-gray-500 mt-20">
                            Select a stop on the map to view details.
                        </div>
                    )}
                </div>

                {/* Stop List */}
                <div className="h-1/3 border-t border-gray-700 overflow-y-auto bg-gray-900">
                    {activeTour.stops.map((stop, idx) => (
                        <div 
                            key={stop.id} 
                            onClick={() => setActiveStopId(stop.id)}
                            className={`p-3 border-b border-gray-800 cursor-pointer flex items-center space-x-3 hover:bg-gray-800 transition ${activeStopId === stop.id ? 'bg-gray-800 border-l-4 border-l-primary' : ''}`}
                        >
                            <div className="bg-gray-700 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-gray-300">
                                {idx + 1}
                            </div>
                            <div>
                                <h4 className={`text-sm font-medium ${activeStopId === stop.id ? 'text-primary' : 'text-gray-300'}`}>{stop.title}</h4>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="text-center max-w-2xl mx-auto mb-12">
         <h1 className="text-3xl font-bold mb-4">Explore Tours</h1>
         <p className="text-gray-400">Select a tour to begin your journey. Follow the path and listen to AI-curated stories.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tours.map(tour => (
          <div key={tour.id} className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 hover:border-primary transition shadow-xl group">
             <div className="h-48 bg-gray-700 relative overflow-hidden">
                <img 
                    src={tour.coverUrl || `https://picsum.photos/seed/${tour.id}/400/200`} 
                    alt="Tour Cover" 
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-500" 
                />
                <div className="absolute inset-0 bg-gradient-to-t from-gray-900 to-transparent"></div>
                <div className="absolute bottom-4 left-4">
                    <h3 className="text-xl font-bold text-white shadow-sm">{tour.title}</h3>
                </div>
             </div>
             <div className="p-6">
                <p className="text-gray-400 text-sm line-clamp-3 mb-6">{tour.description || "Join this amazing tour."}</p>
                <div className="flex items-center justify-between">
                    <span className="bg-gray-700 text-gray-300 px-3 py-1 rounded-full text-xs">
                        {tour.stops.length} Stops
                    </span>
                    <button 
                        onClick={() => startTour(tour)}
                        className="bg-primary hover:bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition"
                    >
                        Start Tour <i className="fa-solid fa-arrow-right ml-1"></i>
                    </button>
                </div>
             </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ConsumerPage;