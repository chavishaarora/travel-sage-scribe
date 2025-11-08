import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, conversationId } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get conversation details
    const { data: conversation } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .single();

    // System prompt for the travel agent
    const systemPrompt = `You are an intelligent AI travel agent. Your goal is to help users plan their perfect trip by:

1. Asking follow-up questions to understand their needs:
   - Destination preferences (they can also select on the map)
   - Travel dates
   - Budget range
   - Number of travelers
   - Accommodation preferences
   - Activities and interests

2. Once you have enough information, provide specific recommendations for:
   - Flights (with estimated prices)
   - Hotels (with ratings and price ranges)
   - Attractions and activities

3. Be conversational, friendly, and helpful. Ask one or two questions at a time.

Current conversation info:
- Destination: ${conversation?.destination || "not specified"}
- Budget: ${conversation?.budget || "not specified"}
- Travelers: ${conversation?.travelers_count || "not specified"}
- Start date: ${conversation?.start_date || "not specified"}
- End date: ${conversation?.end_date || "not specified"}

If the user has selected a location on the map, they will mention it in their message.`;

    // Call Lovable AI
    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            ...messages,
          ],
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({
            error: "Rate limit exceeded. Please try again later.",
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({
            error: "Payment required. Please add credits to continue.",
          }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const errorText = await response.text();
      console.error("AI API error:", response.status, errorText);
      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    // Parse AI response to extract structured info and update conversation
    const lowerResponse = aiResponse.toLowerCase();
    
    // Simple keyword extraction for conversation updates
    const updates: any = {};
    
    if (!conversation?.destination && lowerResponse.includes("destination")) {
      // Try to extract destination from user's last message
      const lastUserMsg = messages.filter((m: any) => m.role === "user").pop();
      if (lastUserMsg) {
        updates.destination = lastUserMsg.content;
      }
    }

    if (Object.keys(updates).length > 0) {
      await supabase
        .from("conversations")
        .update(updates)
        .eq("id", conversationId);
    }

    return new Response(JSON.stringify({ response: aiResponse }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in travel-chat function:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
