import React, { useEffect, useRef, useState } from 'react';
import { Tour, GeoPoint } from '../types';

// Declare Leaflet global
declare global {
  interface Window {
    L: any;
  }
}

interface TourMapProps {
  tour: Tour;
  activeStopId?: string;
  onStopClick?: (stopId: string) => void;
  userLocation?: GeoPoint | null;
}

const TourMap: React.FC<TourMapProps> = ({ tour, activeStopId, onStopClick, userLocation }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const tourLayerRef = useRef<any>(null);
  const userLayerRef = useRef<any>(null);
  const markersRef = useRef<{[id: string]: any}>({});
  const [isMapReady, setIsMapReady] = useState(false);

  // Helper to create icon structure
  const createMarkerIcon = (index: number, isActive: boolean) => {
     if (!window.L) return null;
     
     const markerHtml = `
        <div class="relative flex items-center justify-center w-6 h-6 transform transition-all duration-300 ${isActive ? 'scale-125 z-50' : 'z-10'}">
            <div class="absolute w-full h-full rounded-full ${isActive ? 'bg-amber-500 animate-ping opacity-75' : 'hidden'}"></div>
            <div class="relative w-6 h-6 rounded-full border-2 border-white ${isActive ? 'bg-amber-500' : 'bg-teal-600'} shadow-lg flex items-center justify-center text-[10px] font-bold text-white">
                ${index + 1}
            </div>
        </div>
    `;

    return window.L.divIcon({
        className: 'custom-map-marker',
        html: markerHtml,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
  };

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
    if (!window.L) {
        console.error("Leaflet not found. Ensure the script is included in index.html");
        return;
    }

    // Default center (Paris)
    const map = window.L.map(mapContainerRef.current).setView([48.8566, 2.3522], 13);
    
    // Dark matter tiles
    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    // Create layer groups
    tourLayerRef.current = window.L.layerGroup().addTo(map);
    userLayerRef.current = window.L.layerGroup().addTo(map);
    
    mapInstanceRef.current = map;
    setIsMapReady(true);
    
    // Fix: Invalidate size after a short delay to ensure correct rendering
    setTimeout(() => {
        if (mapInstanceRef.current) {
            mapInstanceRef.current.invalidateSize();
        }
    }, 200);

    return () => {
        if (mapInstanceRef.current) {
            mapInstanceRef.current.remove();
            mapInstanceRef.current = null;
            setIsMapReady(false);
        }
    };
  }, []);

  // 1.5 Handle Resize
  useEffect(() => {
    if (!mapContainerRef.current) return;
    const resizeObserver = new ResizeObserver(() => {
        if (mapInstanceRef.current) {
            mapInstanceRef.current.invalidateSize();
        }
    });
    resizeObserver.observe(mapContainerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // 2. Render Stops and Path (Run when tour stops or map readiness changes)
  useEffect(() => {
    if (!isMapReady || !mapInstanceRef.current || !tourLayerRef.current || !window.L) return;

    const map = mapInstanceRef.current;
    const layerGroup = tourLayerRef.current;

    // Clear previous tour layers
    layerGroup.clearLayers();
    markersRef.current = {};

    const stops = tour.stops;
    if (stops.length === 0) return;

    const latLngs: [number, number][] = stops.map(s => [s.location.lat, s.location.lng]);

    // Draw Path
    if (latLngs.length > 1) {
        window.L.polyline(latLngs, {
            color: '#0f766e', // teal-700
            weight: 4,
            opacity: 0.7,
            dashArray: '10, 10'
        }).addTo(layerGroup);
    }

    // Draw Markers (Initial State)
    stops.forEach((stop, index) => {
        // Initially set icon based on activeStopId props passed during this render
        const isActive = stop.id === activeStopId;
        const icon = createMarkerIcon(index, isActive);

        const marker = window.L.marker([stop.location.lat, stop.location.lng], { icon })
            .addTo(layerGroup)
            .on('click', () => {
                if (onStopClick) onStopClick(stop.id);
            });

        // Tooltip
        marker.bindTooltip(stop.title, {
            permanent: false,
            direction: 'top',
            offset: [0, -12],
            className: 'bg-gray-800 text-gray-100 border border-gray-600 px-2 py-1 rounded shadow-xl font-sans text-xs'
        });

        markersRef.current[stop.id] = marker;
    });

    // Fit Bounds (Only on tour load, if no specific active stop is forcing a view)
    // We only fit bounds if we aren't about to fly to a specific active stop in the next effect.
    // Or we can just fit bounds initially and let flyTo override it.
    if (latLngs.length > 0 && !activeStopId) {
        const bounds = window.L.latLngBounds(latLngs);
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }

  }, [tour.stops, isMapReady]); // Ensure this runs when map becomes ready

  // 3. Update Markers & Pan (Run when activeStopId changes)
  useEffect(() => {
    if (!isMapReady || !mapInstanceRef.current || !window.L) return;
    const map = mapInstanceRef.current;

    // Update icons for all markers to reflect new active state
    tour.stops.forEach((stop, index) => {
        const marker = markersRef.current[stop.id];
        if (marker) {
            const isActive = stop.id === activeStopId;
            const newIcon = createMarkerIcon(index, isActive);
            marker.setIcon(newIcon);
            
            // Manage Z-Index to bring active to front
            marker.setZIndexOffset(isActive ? 1000 : 0);

            if (isActive) {
                marker.openTooltip();
            } else {
                marker.closeTooltip();
            }
        }
    });

    // Fly to active stop
    if (activeStopId) {
        const stop = tour.stops.find(s => s.id === activeStopId);
        if (stop) {
            map.flyTo([stop.location.lat, stop.location.lng], 16, {
                animate: true,
                duration: 1.0 // Slightly faster duration for snappier feel
            });
        }
    }
  }, [activeStopId, tour.stops, isMapReady]);

  // 4. Render User Location
  useEffect(() => {
    if (!isMapReady || !userLayerRef.current || !window.L || !userLocation) return;
    const layerGroup = userLayerRef.current;

    layerGroup.clearLayers();

    const userHtml = `
        <div class="relative flex items-center justify-center w-4 h-4">
            <div class="absolute w-full h-full rounded-full bg-blue-500 animate-ping opacity-75"></div>
            <div class="relative w-3 h-3 rounded-full border-2 border-white bg-blue-500 shadow-lg"></div>
        </div>
    `;
    const userIcon = window.L.divIcon({
        className: 'user-loc-marker',
        html: userHtml,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
    window.L.marker([userLocation.lat, userLocation.lng], { icon: userIcon, zIndexOffset: 2000 }).addTo(layerGroup);

  }, [userLocation, isMapReady]);

  // 5. Center User Function
  const handleShowMe = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mapInstanceRef.current && userLocation) {
        mapInstanceRef.current.flyTo([userLocation.lat, userLocation.lng], 16, { animate: true });
    }
  };

  return (
    <div className="relative w-full h-full min-h-[400px] rounded-lg overflow-hidden bg-gray-900 border border-gray-700 shadow-inner z-0">
      <div ref={mapContainerRef} className="absolute inset-0 z-0" />
      
      {userLocation && (
        <button 
            onClick={handleShowMe}
            className="absolute bottom-6 right-6 z-[400] bg-gray-800 hover:bg-gray-700 text-white p-3 rounded-full shadow-lg border border-gray-600 transition-all focus:outline-none focus:ring-2 focus:ring-primary group"
            title="Show my location"
        >
            <i className="fa-solid fa-location-crosshairs text-lg text-primary group-hover:scale-110 transition-transform"></i>
        </button>
      )}
    </div>
  );
};

export default TourMap;