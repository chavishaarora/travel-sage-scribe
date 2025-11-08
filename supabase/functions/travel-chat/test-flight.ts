// --- File: test-flights.ts ---

// You'll need to install the path module for the robust loading:
// deno add @std/path 

import { load } from "https://deno.land/std@0.208.0/dotenv/mod.ts";
import { fromFileUrl } from "https://deno.land/std@0.208.0/path/mod.ts";
import {
  BookingComFlightsAPI,
  FlightOffer,
  parseFlightOffers,
} from "./flightClient.ts";

async function runFlightTest() {
  // Load environment variables (path resolution makes this robust)
  const scriptDir = fromFileUrl(new URL('.', import.meta.url));
  const envFilePath = `${scriptDir}/.env`;
  await load({ envPath: envFilePath, export: true });

  console.log("Starting Flight Search Test...");

  const API_HOST = getEnv("BOOKING_API_HOST");
  const API_KEY = getEnv("BOOKING_API_KEY");

  // --- Search Parameters ---
  const options = {
    ORIGIN_QUERY: "New York", // e.g., "New York"
    DESTINATION_QUERY: "Paris", // e.g., "Paris"
    DEPARTURE_DATE: "2025-12-15",
    ADULTS: 2,
    CABIN_CLASS: "ECONOMY" as const,
    PRICE_MAX: 1000,
  };

  // 1. Initialize the API client
  const flightApi = new BookingComFlightsAPI(API_HOST, API_KEY, options);

  // 2. Get Origin Airport ID
  const originSuccess = await flightApi.searchAirport(
    options.ORIGIN_QUERY,
    true,
  );

  // 3. Get Destination Airport ID
  const destinationSuccess = await flightApi.searchAirport(
    options.DESTINATION_QUERY,
    false,
  );

  console.log("\n" + "=".repeat(50));

  let finalFlightOffers: FlightOffer[] = [];

  if (originSuccess && destinationSuccess) {
    // 4. Search for flights
    const flightOptions = await flightApi.searchFlights();

    // 5. Parse and display the results
    if (flightOptions) {
      finalFlightOffers = parseFlightOffers(flightOptions);
    }
  } else {
    console.log(
      "\n⚠️ Flight search aborted due to failure in finding required airport IDs.",
    );
  }

  // Final Output
  console.log("🚀 FINAL RETURNED DATA (Top 3 Offers):");
  if (finalFlightOffers.length > 0) {
    finalFlightOffers.slice(0, 3).forEach((offer, index) => {
      console.log(`\n--- Offer ${index + 1} ---`);
      console.log(`Price: **${offer.price} ${offer.currency}**`);
      console.log(`Summary: ${offer.summary}`);
    });
  } else {
    console.log("null");
  }
  console.log("=".repeat(50));
}

// Run the test
runFlightTest();