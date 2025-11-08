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
    const hasBudgetAllocation = conversationData.budget_allocation; // { hotel, flights, activities }
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
STAGE 8: ALL INFO COLLECTED
Current Trip Details:
- Destination: ${hasDestination}
- Activities Preference: ${hasActivities}
- Total Budget: ${hasBudget}
- Budget Allocation: ${JSON.stringify(hasBudgetAllocation)}
- Dates: ${hasDates}
- Flexibility: ${hasFlexibility}

Now provide day-by-day activity recommendations considering:
- Google reviews for highly-rated activities
- Mix of the activities they're interested in
- Budget constraints
- Local climate and weather

PLACEHOLDER: Flight and hotel recommendations will be added via Booking API
For now, acknowledge that you're preparing to search for flights and hotels but note that integration is pending.

Ask if they want to proceed with booking or need any adjustments.`;
    }

    systemPrompt += `

GENERAL RULES:
- Be conversational, friendly, and helpful
- Ask ONE main question at a time (may include sub-parts)
- Listen carefully to what the user says
- Extract all relevant information from their responses
- If they mention location during conversation, note it as their destination
- Never skip stages - gather info in order
- Be concise - keep responses under 50 words`;

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
        max_tokens: 500,
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
    const aiResponse = data.choices[0].message.content;

    // Extract and update conversation data based on user's last message
    const lastUserMessage = messages.filter((m: any) => m.role === "user").pop()?.content || "";
    const updates: any = {};
    const newPreferences = { ...conversationData };

    // Extract destination if mentioned
    const destinationKeywords = [
      "paris",
      "tokyo",
      "bali",
      "new york",
      "barcelona",
      "london",
      "dubai",
      "thailand",
      "thailand",
      "italy",
      "france",
      "japan",
    ];
    if (!hasDestination) {
      const mentioned = destinationKeywords.find((dest) =>
        lastUserMessage.toLowerCase().includes(dest)
      );
      if (mentioned) {
        updates.destination = mentioned;
      }
    }

    // Extract weather preference
    const weatherKeywords = {
      tropical: ["tropical", "warm", "hot", "beach"],
      temperate: ["mild", "spring", "fall", "moderate"],
      cold: ["snow", "winter", "cold", "skiing"],
      dry: ["dry", "desert", "sunny"],
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
      passive: ["relax", "spa", "museum", "cultural", "beach", "wine"],
      active: ["hiking", "sport", "adventure", "trek", "dive", "climb"],
      mixed: ["mix", "both", "variety"],
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

    // Extract budget allocation
    if (hasBudget && !hasBudgetAllocation) {
      const percentages = lastUserMessage.match(/(\d+)%/g);
      if (percentages && percentages.length >= 2) {
        // Try to parse allocation
        const allocationText = lastUserMessage.toLowerCase();
        if (
          allocationText.includes("hotel") &&
          allocationText.includes("flight")
        ) {
          newPreferences.budget_allocation = {
            hotel: allocationText.includes("50% hotel") ? 50 : 40,
            flights: allocationText.includes("30% flight") ? 30 : 35,
            activities: 25,
          };
        }
      }
    }

    // Extract dates
    if (!hasDates) {
      const dateMatch = lastUserMessage.match(
        /(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})|(\w+\s+\d{1,2})/g
      );
      if (dateMatch) {
        newPreferences.dates = dateMatch.join(" to ");
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
