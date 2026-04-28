import React from 'react';
import { GoogleMap, useJsApiLoader, HeatmapLayer } from '@react-google-maps/api';

const containerStyle = {
  width: '100%',
  height: '500px',
  borderRadius: '2rem'
};

const center = {
  lat: 19.2403, // Kalyan center
  lng: 73.1305
};

interface UrgencyHeatMapProps {
  tasks: Array<{
    location: { coordinates: [number, number] };
    urgencyScore: number;
  }>;
}

const UrgencyHeatMap: React.FC<UrgencyHeatMapProps> = ({ tasks }) => {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: ['visualization']
  });

  const heatmapData = tasks.map(task => ({
    location: new window.google.maps.LatLng(task.location.coordinates[1], task.location.coordinates[0]),
    weight: task.urgencyScore
  }));

  return isLoaded ? (
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={center}
      zoom={13}
      options={{
        styles: [
          {
            "elementType": "geometry",
            "stylers": [{ "color": "#f5f5f5" }]
          },
          {
            "elementType": "labels.icon",
            "stylers": [{ "visibility": "off" }]
          }
        ]
      }}
    >
      <HeatmapLayer
        data={heatmapData}
        options={{
          radius: 40,
          opacity: 0.8
        }}
      />
    </GoogleMap>
  ) : <div className="h-[500px] bg-slate-100 animate-pulse rounded-[2rem]"></div>;
};

export default React.memo(UrgencyHeatMap);
