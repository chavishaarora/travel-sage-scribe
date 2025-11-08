import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Helper function to create Google Maps search URL
function createGoogleMapsUrl(placeName: string, destination: string): string {
  const query = `${placeName} ${destination}`;
  const encodedQuery = encodeURIComponent(query);
  return `https://www.google.com/maps/search/${encodedQuery}`;
}

// Enhanced pattern to capture MORE activity mentions
function parseRecommendationsWithLinks(
  response: string,
  destination: string
): string {
  // EXPANDED pattern with more trigger keywords
  const placePattern =
    /(?:Visit|Dine at|Explore|Try|Experience|Enjoy|Go to|See|Check out|Discover|Browse|Sample|Hike|Trek|Climb|Tour|Take|Do|Participate in|Attend|Join|Relax at|Swim at|Kayak in|Bike through|Walk to|Drive to|Sail on|Surf at|Ski on|Climb|Watch|Taste|Drink|Eat at|Have|Book|Reserve|Book a tour|Take a tour|Go on|View|Visit the|Go for|Catch|Watch the|Ride|Take a|Have a|Enjoy the|Admire|Appreciate|See the|Walk around|Stroll through|Wander in)\s+([^-\n.;,]*?)(?:\s*[-:.;,]|$|\n)/gi;

  let enhancedResponse = response;
  const matches = response.matchAll(placePattern);
  const processedPlaces = new Set<string>(); // Avoid duplicates

  for (const match of matches) {
    let placeName = match[1]?.trim();
    
    if (placeName && placeName.length > 2 && !processedPlaces.has(placeName.toLowerCase())) {
      // Clean up the place name
      placeName = placeName
        .replace(/\s+/g, " ") // Remove extra spaces
        .split(" - ")[0] // Remove descriptions after dash
        .split(" (")[0] // Remove parentheses
        .trim();

      if (placeName.length > 2) {
        processedPlaces.add(placeName.toLowerCase());
        const mapsUrl = createGoogleMapsUrl(placeName, destination);
        const original = match[0];
        
        // Only add link if not already present
        if (!enhancedResponse.includes(mapsUrl)) {
          const enhanced = `${original}\n🗺️ [${placeName}](${mapsUrl})`;
          enhancedResponse = enhancedResponse.replace(original, enhanced);
        }
      }
    }
  }

  return enhancedResponse;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, conversationId } = await req.json();
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
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

    // Determine the current stage of the conversation
    const conversationData = conversation?.preferences || {};
    const hasDestination = conversation?.destination || conversationData.destination;
    const hasWeatherPreference = conversationData.weather_preference;
    const hasActivities = conversationData.activities;
    const hasBudget = conversation?.budget || conversationData.budget;
    const hasBudgetAllocation = conversationData.budget_allocation;
    const hasDates = conversation?.start_date || conversationData.dates;
    const hasFlexibility = conversationData.date_flexibility;

    // Build system prompt based on conversation stage
    let systemPrompt = `You are an intelligent AI travel agent. Your goal is to help users plan their perfect trip by gathering information step by step.

CONVERSATION STAGE RULES:
`;

    if (!hasDestination) {
      systemPrompt += `
STAGE 1: NO DESTINATION YET
- First, ask about their preferred weather/climate (tropical, temperate, cold, dry, rainy, etc.)
- Based on their weather preference, suggest 2-3 specific destinations
- Ask which destination appeals to them
- Do NOT ask about activities or budget yet`;
    } else if (!hasWeatherPreference) {
      systemPrompt += `
STAGE 2: DESTINATION SELECTED (${hasDestination})
- Confirm the selected destination
- Ask about types of activities they're interested in:
  * Passive/relaxing (beach, spa, cultural tours, museums)
  * Active (hiking, water sports, adventure activities)
  * Mix of both
- Do NOT ask about budget or dates yet`;
    } else if (!hasActivities) {
      systemPrompt += `
STAGE 3: ACTIVITIES NOT YET SPECIFIED
- Ask about the types of activities they're interested in:
  * Passive/relaxing (beach, spa, cultural tours, museums)
  * Active (hiking, water sports, adventure activities)
  * Mix of both
- Acknowledge their destination preference
- Do NOT ask about budget or dates yet`;
    } else if (!hasBudget) {
      systemPrompt += `
STAGE 4: BUDGET NOT SET
- Ask for their total budget for the entire trip
- Then ask how they want to allocate it:
  * What % should go to accommodation?
  * What % should go to flights?
  * What % should go to activities?
  * Make sure it adds up to 100%
- Be conversational and help them think through allocation`;
    } else if (!hasBudgetAllocation) {
      systemPrompt += `
STAGE 5: ALLOCATE BUDGET
- They have a total budget of: ${conversation?.budget}
- Ask them to allocate their budget across:
  * Accommodation (hotels)
  * Flights
  * Activities
- Help them decide on reasonable splits
- Confirm the total equals their budget`;
    } else if (!hasDates) {
      systemPrompt += `
STAGE 6: DATES NOT SET
- Ask for their preferred travel dates (start and end)
- Ask if they have flexibility with dates (yes/no/somewhat)
- Explain how flexibility can affect prices`;
    } else if (!hasFlexibility) {
      systemPrompt += `
STAGE 7: CHECK DATE FLEXIBILITY
- Ask if they're flexible with their dates (strictly booked or can move ±3-7 days?)
- This helps with finding better flight and hotel deals`;
    } else {
      systemPrompt += `
STAGE 8: ALL INFO COLLECTED - GENERATE DETAILED ITINERARY
Current Trip Details:
- Destination: ${hasDestination}
- Activities Preference: ${hasActivities}
- Total Budget: ${hasBudget}
- Dates: ${hasDates}
- Flexibility: ${hasFlexibility}

INSTRUCTIONS FOR GENERATING RECOMMENDATIONS:
1. Create a day-by-day itinerary based on their preferences
2. VERY IMPORTANT - For EACH activity, restaurant, or attraction mentioned:
   - Use SPECIFIC place names (not generic descriptions)
   - Include descriptive verbs from this list:
     Visit, Dine at, Explore, Try, Experience, Enjoy, Go to, See, Check out,
     Discover, Browse, Sample, Hike, Trek, Climb, Tour, Take, Do, Participate in,
     Attend, Join, Relax at, Swim at, Kayak in, Bike through, Walk to, Drive to,
     Sail on, Surf at, Ski on, Watch, Taste, Drink, Eat at, Have, Book, Reserve,
     Take a tour, Go on, View, Catch, Ride, Admire, Appreciate, Stroll through,
     Wander in
   - Examples of GOOD format:
     * "Visit Louvre Museum - €15/person ⭐ 4.6/5"
     * "Dine at L'Astrance Restaurant - €120/person ⭐ 4.5/5"
     * "Trek the GR20 Trail - Full day experience ⭐ 4.8/5"
     * "Swim at Palombaggia Beach - Free ⭐ 4.7/5"
     * "Kayak in Scandola Nature Reserve - €50/person ⭐ 4.9/5"
   
   - The system will AUTOMATICALLY add Google Maps links for EACH place
   
3. Include a good mix of:
   - Breakfast/lunch/dinner recommendations
   - Activities matching their preferences
   - Local experiences and cultural sites
   - Both budget-friendly and premium options

4. Respect their budget constraints and spread recommendations across trip days

5. CRITICAL: Always use specific place NAMES, not generic descriptions
   ✓ CORRECT: "Visit Uffizi Gallery"
   ✗ WRONG: "Visit museums"
   ✓ CORRECT: "Hike to Tre Cime di Lavaredo"
   ✗ WRONG: "Go hiking"

FORMAT YOUR ITINERARY LIKE THIS:
Day 1: [Destination/Region]
- Morning: [Verb] [Specific Place Name] - [Cost] ⭐ [Rating]
- Lunch: [Verb] [Specific Restaurant Name] - [Cost] ⭐ [Rating]
- Afternoon: [Verb] [Specific Activity/Place] - [Cost] ⭐ [Rating]
- Dinner: [Verb] [Specific Restaurant Name] - [Cost] ⭐ [Rating]

The system will automatically convert these to Google Maps links!`;
    }

    systemPrompt += `

GENERAL RULES:
- Be conversational, friendly, and helpful
- Ask ONE main question at a time (may include sub-parts)
- Listen carefully to what the user says
- Extract all relevant information from their responses
- If they mention location during conversation, note it as their destination
- Never skip stages - gather info in order
- Be concise - keep responses under 150 words for stage transitions`;

    // Call OpenAI ChatGPT
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        temperature: 0.7,
        max_tokens: 1200,
      }),
    });

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
      if (response.status === 401) {
        return new Response(
          JSON.stringify({
            error: "Invalid API key. Please check your OpenAI configuration.",
          }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const errorText = await response.text();
      console.error("OpenAI API error:", response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    let aiResponse = data.choices[0].message.content;

    // Add Google Maps links to the response if we're at the itinerary stage
    if (hasDestination && hasActivities && hasBudget && hasDates && hasFlexibility) {
      aiResponse = parseRecommendationsWithLinks(aiResponse, hasDestination);
    }

    // Extract and update conversation data based on user's last message
    const lastUserMessage = messages.filter((m: any) => m.role === "user").pop()?.content || "";
    const updates: any = {};
    const newPreferences = { ...conversationData };

    // Extract destination if mentioned
    const destinationKeywords = [
      "paris", "tokyo", "bali", "new york", "barcelona", "london", "dubai",
      "thailand", "italy", "france", "japan", "spain", "greece", "amsterdam",
      "berlin", "rome", "venice", "istanbul", "morocco", "egypt", "corsica",
      "provence", "swiss", "austria", "iceland", "norway", "korea", "mexico",
    ];
    if (!hasDestination) {
      const mentioned = destinationKeywords.find((dest) =>
        lastUserMessage.toLowerCase().includes(dest)
      );
      if (mentioned) {
        updates.destination = mentioned.charAt(0).toUpperCase() + mentioned.slice(1);
      }
    }

    // Extract weather preference
    const weatherKeywords = {
      tropical: ["tropical", "warm", "hot", "beach", "sunny", "caribbean"],
      temperate: ["mild", "spring", "fall", "moderate", "pleasant", "cool"],
      cold: ["snow", "winter", "cold", "skiing", "cozy", "alpine"],
      dry: ["dry", "desert", "sunny", "arid", "mediterranean"],
    };
    if (!hasWeatherPreference) {
      for (const [weather, keywords] of Object.entries(weatherKeywords)) {
        if (keywords.some((kw) => lastUserMessage.toLowerCase().includes(kw))) {
          newPreferences.weather_preference = weather;
          break;
        }
      }
    }

    // Extract activities
    const activityKeywords = {
      passive: ["relax", "spa", "museum", "cultural", "beach", "wine", "tour", "gallery"],
      active: ["hiking", "sport", "adventure", "trek", "dive", "climb", "water", "biking"],
      mixed: ["mix", "both", "variety", "everything", "combination"],
    };
    if (!hasActivities) {
      for (const [activity, keywords] of Object.entries(activityKeywords)) {
        if (keywords.some((kw) => lastUserMessage.toLowerCase().includes(kw))) {
          newPreferences.activities = activity;
          break;
        }
      }
    }

    // Extract budget
    if (!hasBudget) {
      const budgetMatch = lastUserMessage.match(/\$?([\d,]+)/);
      if (budgetMatch) {
        const budgetAmount = parseInt(budgetMatch[1].replace(/,/g, ""));
        updates.budget = budgetAmount.toString();
      }
    }

    // Extract dates
    if (!hasDates) {
      const dateMatch = lastUserMessage.match(
        /(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})|(\w+\s+\d{1,2})|(\d+\s+(?:days|nights|weeks))/gi
      );
      if (dateMatch) {
        newPreferences.dates = dateMatch.join(" ");
      }
    }

    // Extract date flexibility
    if (hasDates && !hasFlexibility) {
      const flexibleKeywords = ["flexible", "can move", "somewhat", "yes"];
      const strictKeywords = ["strict", "fixed", "exact", "no"];

      if (flexibleKeywords.some((kw) =>
        lastUserMessage.toLowerCase().includes(kw)
      )) {
        newPreferences.date_flexibility = "flexible";
      } else if (strictKeywords.some((kw) =>
        lastUserMessage.toLowerCase().includes(kw)
      )) {
        newPreferences.date_flexibility = "strict";
      }
    }

    // Update conversation with new preferences
    if (Object.keys(updates).length > 0 || Object.keys(newPreferences).length > 0) {
      await supabase
        .from("conversations")
        .update({
          ...updates,
          preferences: newPreferences,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId);
    }

    return new Response(JSON.stringify({ response: aiResponse }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in travel-chat function:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});