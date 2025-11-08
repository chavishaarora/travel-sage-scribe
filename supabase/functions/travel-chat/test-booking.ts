// --- File: test-booking.ts ---

// Import the 'load' function to read your .env file
import { load } from "https://deno.land/std@0.208.0/dotenv/mod.ts";
import { fromFileUrl } from "https://deno.land/std@0.208.0/path/mod.ts"; // Import path utility

// Import your Booking API class and HotelResult type
import { BookingComAPI, HotelResult } from "./bookingClient.ts";

// --- START: Copy the searchHotels function from index.ts ---
// We copy it here so we can run it directly for testing
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
    // Use the new getter function!
    resultData.destination = apiClient.getDestinationName();

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
// --- END: Copy the searchHotels function ---

async function runTest() {
  // 1. Get the directory of the current script
  const scriptDir = fromFileUrl(new URL('.', import.meta.url));
  
  // 2. Construct the full path to the .env file
  const envFilePath = `${scriptDir}/.env`;

  // 3. Load environment variables from the specific path
  // Note: Using `allow-read` is essential for this!
  await load({ envPath: envFilePath, export: true }); 
  
  console.log("Starting test...");

  // // DEBUG: Verify the key is loaded
  // console.log("Loaded API Host:", Deno.env.get("BOOKING_API_HOST")); 

  // Use the exact values from your server example
  const hotelData = await searchHotels(
    "Corsica",       // hasDestination
    "2025-11-20",    // exampleArrival
    "2025-11-25",    // exampleDeparture
    1000             // budgetMax
  );

  console.log("\n=======================================================");
  console.log("🚀 FINAL RETURNED DATA:");
  // Print the final JSON data in a nice format
  console.log(JSON.stringify(hotelData, null, 2));
  console.log("=======================================================");
}

// Run the test
runTest();