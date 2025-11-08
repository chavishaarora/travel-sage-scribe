import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface MapViewProps {
  selectedLocation: { lat: number; lng: number; name: string } | null;
  onLocationSelect: (location: { lat: number; lng: number; name: string }) => void;
}

const MapView = ({ selectedLocation, onLocationSelect }: MapViewProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const marker = useRef<mapboxgl.Marker | null>(null);
  const [mapboxToken, setMapboxToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);

  useEffect(() => {
    // Check if token exists in localStorage
    const savedToken = localStorage.getItem("mapbox_token");
    if (savedToken) {
      setMapboxToken(savedToken);
      setTokenSaved(true);
      initializeMap(savedToken);
    }
  }, []);

  const initializeMap = (token: string) => {
    if (!mapContainer.current || map.current) return;

    mapboxgl.accessToken = token;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [0, 20],
      zoom: 2,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    // Add click handler
    map.current.on("click", async (e) => {
      const { lng, lat } = e.lngLat;

      // Remove old marker
      if (marker.current) {
        marker.current.remove();
      }

      // Add new marker
      marker.current = new mapboxgl.Marker({ color: "#0EA5E9" })
        .setLngLat([lng, lat])
        .addTo(map.current!);

      // Get location name via reverse geocoding
      try {
        const response = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}`
        );
        const data = await response.json();
        const placeName = data.features[0]?.place_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

        onLocationSelect({ lat, lng, name: placeName });
        toast.success(`Selected: ${placeName}`);
      } catch (error) {
        console.error("Geocoding error:", error);
        onLocationSelect({ lat, lng, name: `${lat.toFixed(4)}, ${lng.toFixed(4)}` });
      }
    });
  };

  const handleSaveToken = () => {
    if (!mapboxToken.trim()) {
      toast.error("Please enter a Mapbox token");
      return;
    }

    localStorage.setItem("mapbox_token", mapboxToken);
    setTokenSaved(true);
    initializeMap(mapboxToken);
    toast.success("Mapbox token saved!");
  };

  useEffect(() => {
    if (selectedLocation && map.current) {
      map.current.flyTo({
        center: [selectedLocation.lng, selectedLocation.lat],
        zoom: 10,
        essential: true,
      });

      if (marker.current) {
        marker.current.remove();
      }

      marker.current = new mapboxgl.Marker({ color: "#0EA5E9" })
        .setLngLat([selectedLocation.lng, selectedLocation.lat])
        .addTo(map.current);
    }
  }, [selectedLocation]);

  if (!tokenSaved) {
    return (
      <div className="h-full flex items-center justify-center bg-muted p-8">
        <div className="max-w-md w-full space-y-4">
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold text-foreground">Mapbox Token Required</h3>
            <p className="text-sm text-muted-foreground">
              To use the interactive map, please provide your Mapbox public token.
              Get one free at{" "}
              <a
                href="https://mapbox.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                mapbox.com
              </a>
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mapbox-token">Mapbox Public Token</Label>
            <Input
              id="mapbox-token"
              type="text"
              placeholder="pk.eyJ1..."
              value={mapboxToken}
              onChange={(e) => setMapboxToken(e.target.value)}
            />
          </div>
          <Button onClick={handleSaveToken} className="w-full">
            Save Token
          </Button>
        </div>
      </div>
    );
  }

  return <div ref={mapContainer} className="h-full w-full" />;
};

export default MapView;
