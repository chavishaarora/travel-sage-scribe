import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plane, MapPin, Hotel, Star } from "lucide-react";

const Index = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user is logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate("/dashboard");
      } else {
        setLoading(false);
      }
    });
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-hero">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-20 text-center text-white">
        <div className="flex items-center justify-center mb-6">
          <Plane className="h-16 w-16" />
        </div>
        <h1 className="text-5xl md:text-6xl font-bold mb-6">
          Your AI Travel Agent
        </h1>
        <p className="text-xl md:text-2xl mb-8 max-w-2xl mx-auto opacity-90">
          Let AI plan your perfect trip. Chat, select destinations on the map, and get personalized recommendations for flights, hotels, and attractions.
        </p>
        <Button
          size="lg"
          onClick={() => navigate("/auth")}
          className="bg-white text-primary hover:bg-white/90 shadow-glow text-lg px-8 py-6"
        >
          Get Started
        </Button>
      </div>

      {/* Features Section */}
      <div className="bg-background py-20">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-foreground mb-12">
            How It Works
          </h2>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div className="text-center p-6 rounded-lg bg-card shadow-card">
              <div className="flex items-center justify-center mb-4">
                <div className="p-3 bg-primary/10 rounded-full">
                  <Plane className="h-8 w-8 text-primary" />
                </div>
              </div>
              <h3 className="text-xl font-semibold mb-2 text-foreground">Chat with AI</h3>
              <p className="text-muted-foreground">
                Tell our AI agent about your travel preferences. It asks follow-up questions to understand exactly what you need.
              </p>
            </div>

            <div className="text-center p-6 rounded-lg bg-card shadow-card">
              <div className="flex items-center justify-center mb-4">
                <div className="p-3 bg-accent/10 rounded-full">
                  <MapPin className="h-8 w-8 text-accent" />
                </div>
              </div>
              <h3 className="text-xl font-semibold mb-2 text-foreground">Select Destinations</h3>
              <p className="text-muted-foreground">
                Click on our interactive map to choose your destinations visually. No typing required!
              </p>
            </div>

            <div className="text-center p-6 rounded-lg bg-card shadow-card">
              <div className="flex items-center justify-center mb-4">
                <div className="p-3 bg-secondary/10 rounded-full">
                  <Hotel className="h-8 w-8 text-secondary" />
                </div>
              </div>
              <h3 className="text-xl font-semibold mb-2 text-foreground">Get Recommendations</h3>
              <p className="text-muted-foreground">
                Receive personalized suggestions for flights, hotels, and attractions. Your profile auto-fills check-in details.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="bg-gradient-hero text-white py-20">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Plan Your Trip?</h2>
          <p className="text-xl mb-8 opacity-90">
            Sign up now and let AI handle the planning.
          </p>
          <Button
            size="lg"
            onClick={() => navigate("/auth")}
            className="bg-white text-primary hover:bg-white/90 shadow-glow text-lg px-8 py-6"
          >
            Start Planning
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Index;
