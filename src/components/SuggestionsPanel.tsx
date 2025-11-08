import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plane, Hotel, MapPin, Star, ExternalLink } from "lucide-react";

interface Suggestion {
  id: string;
  type: "flight" | "hotel" | "attraction";
  title: string;
  description: string;
  price: number;
  rating: number;
  image_url: string;
  booking_url: string;
}

const SuggestionsPanel = () => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSuggestions();
  }, []);

  const loadSuggestions = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get active conversation
      const { data: conversations } = await supabase
        .from("conversations")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1);

      if (!conversations || conversations.length === 0) return;

      // Load suggestions
      const { data, error } = await supabase
        .from("travel_suggestions")
        .select("*")
        .eq("conversation_id", conversations[0].id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setSuggestions(data as Suggestion[]);
    } catch (error) {
      console.error("Failed to load suggestions:", error);
    } finally {
      setLoading(false);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "flight":
        return <Plane className="h-5 w-5" />;
      case "hotel":
        return <Hotel className="h-5 w-5" />;
      case "attraction":
        return <MapPin className="h-5 w-5" />;
      default:
        return <MapPin className="h-5 w-5" />;
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Loading suggestions...</p>
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <MapPin className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">No Suggestions Yet</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Chat with the AI agent to get personalized travel recommendations for flights, hotels, and attractions.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <h3 className="text-lg font-semibold text-foreground mb-4">Travel Suggestions</h3>
      {suggestions.map((suggestion) => (
        <Card key={suggestion.id} className="p-4 shadow-card hover:shadow-glow transition-shadow">
          <div className="flex gap-4">
            {suggestion.image_url && (
              <img
                src={suggestion.image_url}
                alt={suggestion.title}
                className="w-24 h-24 object-cover rounded-lg"
              />
            )}
            <div className="flex-1 space-y-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {getIcon(suggestion.type)}
                  <h4 className="font-semibold text-foreground">{suggestion.title}</h4>
                </div>
                <Badge variant="secondary" className="capitalize">
                  {suggestion.type}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">{suggestion.description}</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {suggestion.price > 0 && (
                    <span className="text-lg font-bold text-primary">${suggestion.price}</span>
                  )}
                  {suggestion.rating > 0 && (
                    <div className="flex items-center gap-1">
                      <Star className="h-4 w-4 fill-secondary text-secondary" />
                      <span className="text-sm text-foreground">{suggestion.rating.toFixed(1)}</span>
                    </div>
                  )}
                </div>
                {suggestion.booking_url && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={suggestion.booking_url} target="_blank" rel="noopener noreferrer">
                      View Details
                      <ExternalLink className="h-3 w-3 ml-2" />
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};

export default SuggestionsPanel;
