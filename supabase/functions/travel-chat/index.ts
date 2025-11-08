import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BookingComAPI, HotelResult } from "./bookingClient.ts";

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
  const placePattern =
    /(?:Visit|Dine at|Explore|Try|Experience|Enjoy|Go to|See|Check out|Discover|Browse|Sample|Hike|Trek|Climb|Tour|Take|Do|Participate in|Attend|Join|Relax at|Swim at|Kayak in|Bike through|Walk to|Drive to|Sail on|Surf at|Ski on|Climb|Watch|Taste|Drink|Eat at|Have|Book|Reserve|Book a tour|Take a tour|Go on|View|Visit the|Go for|Catch|Watch the|Ride|Take a|Have a|Enjoy the|Admire|Appreciate|See the|Walk around|Stroll through|Wander in)\s+([^-\n.;,]*?)(?:\s*[-:.;,]|$|\n)/gi;

  let enhancedResponse = response;
  const matches = response.matchAll(placePattern);
  const processedPlaces = new Set<string>();

  for (const match of matches) {
    let placeName = match[1]?.trim();
    
    if (placeName && placeName.length > 2 && !processedPlaces.has(placeName.toLowerCase())) {
      placeName = placeName
        .replace(/\s+/g, " ")
        .split(" - ")[0]
        .split(" (")[0]
        .trim();

      if (placeName.length > 2) {
        processedPlaces.add(placeName.toLowerCase());
        const mapsUrl = createGoogleMapsUrl(placeName, destination);
        const original = match[0];
        
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
    const hasOrigin = conversationData.origin;
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

    if (!hasOrigin) {
      systemPrompt += `
STAGE 1: NO ORIGIN YET
- Start by asking where they'll be traveling FROM (their origin city/country)
- Be friendly and explain this helps with flight planning and travel time considerations
- Do NOT ask about destination or other details yet`;
    } else if (!hasDestination) {
      systemPrompt += `
STAGE 2: NO DESTINATION YET (Origin: ${hasOrigin})
- Now ask about their preferred weather/climate (tropical, temperate, cold, dry, rainy, etc.)
- Based on their weather preference, suggest 2-3 specific destinations
- Ask which destination appeals to them
- Do NOT ask about activities or budget yet`;
    } else if (!hasWeatherPreference) {
      systemPrompt += `
STAGE 3: DESTINATION SELECTED (Origin: ${hasOrigin}, Destination: ${hasDestination})
- Confirm the selected destination
- Ask about types of activities they're interested in:
  * Passive/relaxing (beach, spa, cultural tours, museums)
  * Active (hiking, water sports, adventure activities)
  * Mix of both
- Do NOT ask about budget or dates yet`;
    } else if (!hasActivities) {
      systemPrompt += `
STAGE 4: ACTIVITIES NOT YET SPECIFIED
- Ask about the types of activities they're interested in:
  * Passive/relaxing (beach, spa, cultural tours, museums)
  * Active (hiking, water sports, adventure activities)
  * Mix of both
- Acknowledge their destination preference
- Do NOT ask about budget or dates yet`;
    } else if (!hasBudget) {
      systemPrompt += `
STAGE 5: BUDGET NOT SET
- Ask for their total budget for the entire trip
- Then ask how they want to allocate it:
  * What % should go to accommodation?
  * What % should go to flights?
  * What % should go to activities?
  * Make sure it adds up to 100%
- Be conversational and help them think through allocation`;
    } else if (!hasBudgetAllocation) {
      systemPrompt += `
STAGE 6: ALLOCATE BUDGET
- They have a total budget of: ${conversation?.budget}
- Ask them to allocate their budget across:
  * Accommodation (hotels)
  * Flights
  * Activities
- Help them decide on reasonable splits
- Confirm the total equals their budget`;
    } else if (!hasDates) {
      systemPrompt += `
STAGE 7: DATES NOT SET
- Ask for their preferred travel dates (start and end)
- Ask if they have flexibility with dates (yes/no/somewhat)
- Explain how flexibility can affect prices`;
    } else if (!hasFlexibility) {
      systemPrompt += `
STAGE 8: CHECK DATE FLEXIBILITY
- Ask if they're flexible with their dates (strictly booked or can move ±3-7 days?)
- This helps with finding better flight and hotel deals`;
    } else {
      systemPrompt += `
STAGE 9: ALL INFO COLLECTED - GENERATE DETAILED ITINERARY
Current Trip Details:
- Origin: ${hasOrigin}
- Destination: ${hasDestination}
- Activities Preference: ${hasActivities}
- Total Budget: ${hasBudget}
- Dates: ${hasDates}
- Flexibility: ${hasFlexibility}`;

      let hotelRecommendation = "";
      
      // Let's assume you have parsed dates and budget
      const exampleArrival = "2025-11-20"; // You need to get this from `hasDates`
      const exampleDeparture = "2025-11-25"; // You need to get this from `hasDates`
      const budgetMax = conversationData.budget_allocation?.accommodation ?? 1000;

      // Call your new function!
      const hotelData = await searchHotels(
        hasDestination, 
        exampleArrival, 
        exampleDeparture, 
        budgetMax
      );

      if (hotelData) {
        console.log("Successfully found a hotel:", hotelData.hotel_name);
        // Add the hotel info to the AI's prompt!
        hotelRecommendation = `
RECOMMENDED HOTEL:
Based on your budget and destination, I found a great option:
- Name: ${hotelData.hotel_name}
- Price: Around ${hotelData.currency} ${hotelData.price}
- Description: ${hotelData.hotel_description}
Please include this hotel as a top suggestion in the itinerary mentioning that it's found on BAZOOKA, a local search tool.
`;
      }
      
      systemPrompt += hotelRecommendation; // Add hotel data to the prompt
      
// --- END: EXAMPLE ---

systemPrompt += `INSTRUCTIONS FOR GENERATING RECOMMENDATIONS:
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
- Be concise - keep responses under 150 words for stage transitions

CRITICAL - INFORMATION EXTRACTION:
After each user response, you MUST extract structured data and return it in a special JSON block at the END of your message.
Format: |||EXTRACT|||{json}|||END|||

Extract these fields when mentioned by the user:
{
  "origin": "string | null",
  "destination": "string | null",
  "weather_preference": "tropical | temperate | cold | dry | null",
  "activities": "passive | active | mixed | null",
  "budget": "number | null",
  "budget_allocation": {"accommodation": number, "flights": number, "activities": number} | null,
  "dates": "string | null",
  "date_flexibility": "flexible | strict | null"
}

Examples:
User: "I'm traveling from New York"
Your response: "[friendly acknowledgment]
|||EXTRACT|||{"origin": "New York"}|||END|||"

User: "I want to go somewhere warm and sunny"
Your response: "[friendly message about warm destinations]
|||EXTRACT|||{"weather_preference": "tropical"}|||END|||"

User: "Let's go to Paris in June"
Your response: "[exciting message about Paris]
|||EXTRACT|||{"destination": "Paris", "dates": "June"}|||END|||"

User: "I'm from London and have $3000 and want to relax at beaches"
Your response: "[helpful message about beach destinations]
|||EXTRACT|||{"origin": "London", "budget": 3000, "activities": "passive", "weather_preference": "tropical"}|||END|||"

ALWAYS include the extraction block, even if empty: |||EXTRACT|||{}|||END|||`;

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

    // Extract structured data from AI response
    const extractMatch = aiResponse.match(/\|\|\|EXTRACT\|\|\|(.*?)\|\|\|END\|\|\|/s);
    let extractedData = {};
    
    if (extractMatch) {
      try {
        extractedData = JSON.parse(extractMatch[1].trim());
        // Remove the extraction block from the user-facing response
        aiResponse = aiResponse.replace(/\|\|\|EXTRACT\|\|\|.*?\|\|\|END\|\|\|/s, '').trim();
      } catch (e) {
        console.error("Failed to parse extracted data:", e);
      }
    }

    // Add Google Maps links to the response if we're at the itinerary stage
    if (hasDestination && hasActivities && hasBudget && hasDates && hasFlexibility) {
      aiResponse = parseRecommendationsWithLinks(aiResponse, hasDestination);
    }

    // Update conversation with extracted data
    const updates: any = {};
    const newPreferences = { ...conversationData };

    // Apply extracted data to updates
    if (extractedData.origin) {
      newPreferences.origin = extractedData.origin;
    }
    if (extractedData.destination) {
      updates.destination = extractedData.destination;
    }
    if (extractedData.weather_preference) {
      newPreferences.weather_preference = extractedData.weather_preference;
    }
    if (extractedData.activities) {
      newPreferences.activities = extractedData.activities;
    }
    if (extractedData.budget) {
      updates.budget = extractedData.budget.toString();
    }
    if (extractedData.budget_allocation) {
      newPreferences.budget_allocation = extractedData.budget_allocation;
    }
    if (extractedData.dates) {
      newPreferences.dates = extractedData.dates;
    }
    if (extractedData.date_flexibility) {
      newPreferences.date_flexibility = extractedData.date_flexibility;
    }

    // Update conversation with new preferences
    if (Object.keys(updates).length > 0 || Object.keys(newPreferences).length > Object.keys(conversationData).length) {
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

// --- Add this function to your index.ts file ---
// --- You can put it right above your `serve(...)` call ---

/**
 * This function performs the full hotel search flow,
 * just like the main() function in your Python script.
 */
async function searchHotels(
  city: string,
  arrival: string,
  departure: string,
  priceMax: number,
): Promise<HotelResult | null> {
  console.log(`Starting hotel search for ${city}...`);
  try {
    // 1. Get API credentials from environment
    const API_HOST = Deno.env.get("BOOKING_API_HOST")!;
    const API_KEY = Deno.env.get("BOOKING_API_KEY")!;

    if (!API_HOST || !API_KEY) {
      console.error("Booking API Host or Key is not set in environment.");
      return null;
    }

    // 2. Initialize the API client with the user's data
    const apiClient = new BookingComAPI(API_HOST, API_KEY, {
      CITY_QUERY: city,
      ARRIVAL_DATE: arrival,
      DEPARTURE_DATE: departure,
      PRICE_MAX: priceMax,
    });

    // 3. Initialize the final result object
    const resultData: HotelResult = {
      destination: city, // Default, will be updated
      hotel_name: "N/A",
      hotel_description: "N/A",
      price: 0,
      currency: "N/A",
      booking_hotel_id: 0,
      hotel_photo_url: [],
      room_photo_url: "N/A",
    };

    // 4. Search Destination (Step 1 in Python)
    if (!await apiClient.searchDestination()) {
      console.log("Final result not available: destination search failed.");
      return null;
    }
    resultData.destination = apiClient.getDestinationName(); // Use the new getter

    // 5. Get Filters (Step 2 in Python - optional, for count)
    await apiClient.getFilters();

    // 6. Search Hotels (Step 3 in Python)
    const hotelSearchResult = await apiClient.searchHotels();
    if (
      !hotelSearchResult || !hotelSearchResult.data ||
      !hotelSearchResult.data.hotels ||
      hotelSearchResult.data.hotels.length === 0
    ) {
      console.log("Final result not available: hotel search failed or no results.");
      return null;
    }

    const firstHotel = hotelSearchResult.data.hotels[0];
    const hotelId = firstHotel.hotel_id;

    // 7. Extract data from hotel search
    resultData.booking_hotel_id = hotelId;
    resultData.hotel_name = firstHotel.property?.name ?? "N/A";
    resultData.hotel_description = firstHotel.accessibilityLabel ?? "N/A";
    
    // Safely extract price
    const priceBreakdown = firstHotel.property?.priceBreakdown?.grossPrice;
    if (priceBreakdown) {
      resultData.price = priceBreakdown.value ?? 0;
      resultData.currency = priceBreakdown.currency ?? "N/A";
    }
    
    resultData.hotel_photo_url = firstHotel.property?.photoUrls ?? [];
    console.log("--- First Hotel Found & Data Collected ---");

    // 8. Get Hotel Details (Step 4 in Python - for room photo)
    const detailsResult = await apiClient.getHotelDetails(hotelId);
    if (detailsResult && detailsResult.data) {
      const rooms = detailsResult.data.rooms;
      if (rooms) {
        try {
          const firstRoomId = Object.keys(rooms)[0];
          const firstRoomData = rooms[firstRoomId];
          const photosList = firstRoomData?.photos ?? [];
          
          for (const photo of photosList) {
            if (photo.url_max1280) {
              resultData.room_photo_url = photo.url_max1280;
              console.log("✅ Extracted first room photo URL.");
              break; // Stop after finding the first one
            }
          }
        } catch (e) {
          console.log("⚠️ No rooms found in details data.");
        }
      }
    }

    console.log("\n🎉 Final Hotel Dictionary Complete.");
    return resultData;

  } catch (error) {
    console.error("Error in searchHotels function:", error);
    return null;
  }
}