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

// Helper function to get month number from month name
function getMonthNumber(monthName: string): string {
  const months: { [key: string]: string } = {
    january: "01", jan: "01",
    february: "02", feb: "02",
    march: "03", mar: "03",
    april: "04", apr: "04",
    may: "05",
    june: "06", jun: "06",
    july: "07", jul: "07",
    august: "08", aug: "08",
    september: "09", sep: "09", sept: "09",
    october: "10", oct: "10",
    november: "11", nov: "11",
    december: "12", dec: "12"
  };
  return months[monthName.toLowerCase()] || "01";
}

// Helper function to normalize dates to YYYY-MM-DD format
function normalizeDate(dateStr: string): string {
  try {
    // If already in YYYY-MM-DD format, return as is
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr;
    }
    
    // Try to parse and format
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    
    // Fallback to current date
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (e) {
    // Return current date on error
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
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
    resultData.destination = apiClient.getDestinationName();

    // 5. Get Filters (Step 2 - optional, for count)
    await apiClient.getFilters();

    // 6. Search Hotels (Step 3)
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

    // 8. Get Hotel Details (Step 4 - for room photo)
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
              break;
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
    const hasConfirmed = conversationData.confirmed;

    // Debug logging
    console.log("=== CONVERSATION STATE ===");
    console.log("hasDestination:", hasDestination);
    console.log("hasDates:", hasDates);
    console.log("hasBudget:", hasBudget);
    console.log("hasConfirmed:", hasConfirmed);
    console.log("========================");

    // Build system prompt based on conversation stage
    let systemPrompt = `You are an intelligent AI travel agent. Your goal is to help users plan their perfect trip by gathering information and providing real hotel recommendations from Booking.com.

CONVERSATION STAGE RULES:
`;

    // Check if we have enough info to search for hotels
    const canSearchHotels = hasDestination && hasDates && hasBudget;

    if (!hasDestination) {
      systemPrompt += `
STAGE 1: GET DESTINATION
- Ask where they want to travel
- Be friendly and conversational
- KEEP YOUR RESPONSE TO MAX 2 SENTENCES`;
    } else if (!hasDates) {
      systemPrompt += `
STAGE 2: GET DATES
- Ask for their travel dates (check-in and check-out)
- KEEP YOUR RESPONSE TO MAX 2 SENTENCES`;
    } else if (!hasBudget) {
      systemPrompt += `
STAGE 3: GET BUDGET
- Ask for their budget for accommodation
- KEEP YOUR RESPONSE TO MAX 2 SENTENCES`;
    } else if (canSearchHotels) {
      systemPrompt += `
STAGE 4: PROVIDE HOTEL RECOMMENDATIONS
Current Trip Details:
- Destination: ${hasDestination}
- Dates: ${hasDates}
- Budget: ${hasBudget}`;

      // Parse dates from the user's input
      let arrivalDate = "";
      let departureDate = "";
      
      // Try to extract dates from the dates string
      if (hasDates) {
        // Try multiple date formats
        const dateMatch = hasDates.match(/(\d{4}-\d{2}-\d{2})|(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})|(\w+ \d{1,2}(?:st|nd|rd|th)?(?:-| to )?\d{1,2}(?:st|nd|rd|th)?)/gi);
        
        if (dateMatch && dateMatch.length >= 2) {
          // Found two dates
          arrivalDate = dateMatch[0];
          departureDate = dateMatch[1];
        } else if (dateMatch && dateMatch.length === 1) {
          // Only one date found, assume it's arrival and add 4 days
          arrivalDate = dateMatch[0];
          const arrival = new Date(arrivalDate);
          arrival.setDate(arrival.getDate() + 4);
          departureDate = arrival.toISOString().split('T')[0];
        } else {
          // Try to parse text like "January 3rd to 7th"
          const monthMatch = hasDates.match(/(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(?:to|-)\s+(\d{1,2})(?:st|nd|rd|th)?/i);
          if (monthMatch) {
            const month = monthMatch[1];
            const day1 = monthMatch[2];
            const day2 = monthMatch[3];
            const year = new Date().getFullYear();
            arrivalDate = `${year}-${getMonthNumber(month)}-${day1.padStart(2, '0')}`;
            departureDate = `${year}-${getMonthNumber(month)}-${day2.padStart(2, '0')}`;
          } else {
            // Fallback: use dates 30 days from now
            const now = new Date();
            now.setDate(now.getDate() + 30);
            arrivalDate = now.toISOString().split('T')[0];
            now.setDate(now.getDate() + 4);
            departureDate = now.toISOString().split('T')[0];
          }
        }
      }

      // Ensure dates are in YYYY-MM-DD format
      arrivalDate = normalizeDate(arrivalDate);
      departureDate = normalizeDate(departureDate);

      // Get accommodation budget - extract number from budget string
      let budgetMax = 1000; // default
      if (hasBudget) {
        const budgetMatch = hasBudget.match(/(\d+)/);
        if (budgetMatch) {
          budgetMax = parseInt(budgetMatch[1]);
        }
      }

      // Search for hotels using the Booking.com API
      let hotelRecommendation = "";
      console.log(`🔍 Searching hotels for ${hasDestination} from ${arrivalDate} to ${departureDate}, max price: ${budgetMax}`);
      
      const hotelData = await searchHotels(
        hasDestination, 
        arrivalDate, 
        departureDate, 
        budgetMax
      );

      if (hotelData) {
        console.log("✅ Successfully found a hotel:", hotelData.hotel_name);
        
        // Create a direct booking link
        const bookingUrl = `https://www.booking.com/hotel/xx/${hotelData.booking_hotel_id}.html?checkin=${arrivalDate}&checkout=${departureDate}`;
        
        // Add the hotel info to the AI's prompt
        hotelRecommendation = `

🏨 **REAL HOTEL FROM BOOKING.COM:**

You MUST include this exact hotel recommendation in your response:

**${hotelData.hotel_name}**
📍 Location: ${hotelData.destination}
💰 Price: ${hotelData.currency} ${hotelData.price.toFixed(2)} for the entire stay (${arrivalDate} to ${departureDate})
📝 ${hotelData.hotel_description}
🔗 Book now: ${bookingUrl}
${hotelData.hotel_photo_url.length > 0 ? `📸 Photos: ${hotelData.hotel_photo_url[0]}` : ''}

INSTRUCTIONS:
1. Start your response by saying you found a hotel on Booking.com
2. Copy the hotel details EXACTLY as shown above
3. Include the booking link
4. Keep your response SHORT - just present the hotel
5. Do NOT suggest other hotels
6. Do NOT make up hotel names or details
`;
      } else {
        console.log("❌ Hotel search failed");
        hotelRecommendation = `

⚠️ HOTEL SEARCH FAILED
I attempted to search Booking.com but couldn't find results. Tell the user:
- You tried searching Booking.com for ${hasDestination}
- Suggest they visit Booking.com directly: https://www.booking.com
- Apologize for the inconvenience
`;
      }
      
      systemPrompt += hotelRecommendation;
    }

    systemPrompt += `

GENERAL RULES:
- Be conversational, friendly, and helpful
- Ask ONE question at a time
- Extract information from user responses
- Once you have destination, dates, and budget, provide the Booking.com hotel

CRITICAL - INFORMATION EXTRACTION:
After each user response, extract structured data and return it at the END of your message.
Format: |||EXTRACT|||{json}|||END|||

Extract these fields:
{
  "destination": "string | null",
  "dates": "string | null",
  "budget": "string | null"
}

Examples:
User: "I want to go to Oberscheinfeld"
|||EXTRACT|||{"destination": "Oberscheinfeld"}|||END|||

User: "January 3rd to 7th"
|||EXTRACT|||{"dates": "January 3rd to 7th"}|||END|||

User: "1000 euros"
|||EXTRACT|||{"budget": "1000 euros"}|||END|||

User: "Oberscheinfeld from January 3-7 with 1000 euro budget"
|||EXTRACT|||{"destination": "Oberscheinfeld", "dates": "January 3-7", "budget": "1000 euro"}|||END|||

ALWAYS include the extraction block: |||EXTRACT|||{}|||END|||`;

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
    if (extractedData.destination) {
      updates.destination = extractedData.destination;
      newPreferences.destination = extractedData.destination;
    }
    if (extractedData.dates) {
      newPreferences.dates = extractedData.dates;
      updates.start_date = extractedData.dates; // Store in start_date field too
    }
    if (extractedData.budget) {
      updates.budget = extractedData.budget;
      newPreferences.budget = extractedData.budget;
    }
// Check if we just completed the final stage
    const justCompleted =
      !hasFlexibility && // We were on the last step
      newPreferences.date_flexibility; // And we just got the answer

    if (justCompleted) {
      console.log("All info collected, searching for hotels...");
      try {
        // 1. Get data from the *newly updated* preferences
        const city = newPreferences.destination;
        const startDate = newPreferences.date_start;
        const endDate = newPreferences.date_end;
        const totalBudget = parseFloat(newPreferences.budget);
        const accomPercent = newPreferences.budget_allocation.accommodation;
        const accomBudget = totalBudget * (accomPercent / 100);

        // 2. Call the search function
        const hotelData = await searchHotels(
          city,
          startDate,
          endDate,
          accomBudget,
        );

        if (hotelData) {
          // 3. Transform data to match 'travel_suggestions' table
          const suggestionToInsert = {
            conversation_id: conversationId,
            type: "hotel",
            title: hotelData.hotel_name,
            description: hotelData.hotel_description,
            price: hotelData.price,
            rating: 0, // Your API result doesn't have a rating, set to 0
            image_url: hotelData.room_photo_url || hotelData.hotel_photo_url[0],
            // The API doesn't return a direct booking link,
            // so we link to the general Booking.com page or Google.
            booking_url: `https_www.google.com/search?q=${
              encodeURIComponent(hotelData.hotel_name + " " + hotelData.destination)
            }`,
            location: { address: hotelData.destination },
          };

          // 4. Save to Supabase
          const { error } = await supabase
            .from("travel_suggestions")
            .insert(suggestionToInsert);
            
          if (error) {
            console.error("Failed to save hotel suggestion:", error);
          } else {
            console.log("Successfully saved hotel suggestion to DB!");
          }
        }
      } catch (e) {
        console.error("Failed to run hotel search:", e);
      }
    }
    
    // Update conversation with new preferences
    if (Object.keys(updates).length > 0 || Object.keys(newPreferences).length > Object.keys(conversationData).length) {
      console.log("Updating conversation with:", updates, newPreferences);
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
