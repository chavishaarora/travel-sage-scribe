// --- File: flightClient.ts ---

// Helper function (re-using the one from bookingClient.ts if needed, but defining here for completeness)
function getEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}

// --- Interfaces for Configuration and Results ---

// Configuration options passed to the constructor
export interface FlightOptions {
  ORIGIN_QUERY: string;
  DESTINATION_QUERY: string;
  DEPARTURE_DATE: string; // YYYY-MM-DD
  STOPS?: "none" | "one" | "two" | "all";
  ADULTS?: number;
  CHILDREN_AGES?: string; // e.g., "0,17"
  SORT_BY?: "BEST" | "CHEAPEST" | "DURATION";
  CABIN_CLASS?: "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";
  CURRENCY_CODE?: string;
  PAGE_NO?: number;
}

// Structure of the final flight data we want to return
export interface FlightOffer {
  price: number;
  currency: string;
  token: string;
  tripType: string;
  segments: any; // Keep segments as 'any' for simplicity in this interface
  summary: string; // A formatted summary string
}

/**
 * A class to interact with the Booking.com RapidAPI Flights endpoint.
 */
export class BookingComFlightsAPI {
  private API_HOST: string;
  private HEADERS: HeadersInit;

  // Search Parameters (defaults based on FlightOptions interface)
  private ORIGIN_QUERY: string;
  private DESTINATION_QUERY: string;
  private DEPARTURE_DATE: string;
  private STOPS: string;
  private ADULTS: number;
  private CHILDREN_AGES: string;
  private SORT_BY: string;
  private CABIN_CLASS: string;
  private CURRENCY_CODE: string;
  private PAGE_NO: number;

  // Variables set dynamically
  private ORIGIN_ID = "";
  private DESTINATION_ID = "";

  constructor(apiHost: string, apiKey: string, options: FlightOptions) {
    this.API_HOST = apiHost;
    this.HEADERS = {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": apiHost,
      "Content-Type": "application/json",
    };

    // Set all parameters from the options object, with defaults
    this.ORIGIN_QUERY = options.ORIGIN_QUERY;
    this.DESTINATION_QUERY = options.DESTINATION_QUERY;
    this.DEPARTURE_DATE = options.DEPARTURE_DATE;
    this.STOPS = options.STOPS ?? "none";
    this.ADULTS = options.ADULTS ?? 1;
    this.CHILDREN_AGES = options.CHILDREN_AGES?.replace(/,/g, "%2C") ?? "0%2C17";
    this.SORT_BY = options.SORT_BY ?? "BEST";
    this.CABIN_CLASS = options.CABIN_CLASS ?? "ECONOMY";
    this.CURRENCY_CODE = options.CURRENCY_CODE ?? "EUR";
    this.PAGE_NO = options.PAGE_NO ?? 1;
  }

  public getOriginId(): string {
    return this.ORIGIN_ID;
  }

  public getDestinationId(): string {
    return this.DESTINATION_ID;
  }

  /** Handles the connection and makes the API request. */
  private async _makeApiCall(
    method: string,
    endpoint: string,
  ): Promise<any | null> {
    const url = `https://${this.API_HOST}${endpoint}`;
    console.log(`\n--- Making ${method} request to: ${url} ---`);

    try {
      const response = await fetch(url, {
        method: method,
        headers: this.HEADERS,
      });

      if (!response.ok) {
        console.error(
          `API call failed with status ${response.status}:`,
          await response.text(),
        );
        return null;
      }

      return await response.json();
    } catch (e) {
      console.error(`An error occurred: ${e.message}`);
      return null;
    }
  }

  /** Finds the airport ID based on the city/airport query. */
  public async searchAirport(query: string, isOrigin: boolean): Promise<boolean> {
    const searchType = isOrigin ? "Origin" : "Destination";

    const params = new URLSearchParams({ query: query });
    const airportEndpoint = `/api/v1/flights/searchDestination?${params.toString()}`;

    const airportDataDict = await this._makeApiCall("GET", airportEndpoint);

    if (airportDataDict && airportDataDict.data && airportDataDict.data.length > 0) {
      // Find the first result of type 'AIRPORT'
      const firstAirportResult = airportDataDict.data.find(
        (item: any) => item.type === "AIRPORT",
      );

      if (firstAirportResult) {
        const airportId = firstAirportResult.id;
        const airportName = firstAirportResult.name;

        if (isOrigin) {
          this.ORIGIN_ID = airportId;
        } else {
          this.DESTINATION_ID = airportId;
        }

        console.log(
          `✅ ${searchType} Airport Search Success: Using **${airportName}**`,
        );
        console.log(`   -> ID: ${airportId}`);
        return true;
      } else {
        console.log(
          `❌ ${searchType} Airport Search Failed: No AIRPORT results found for '${query}'.`,
        );
      }
    } else {
      console.log(
        `❌ ${searchType} Airport Search Failed: API error or empty response for '${query}'.`,
      );
    }

    return false;
  }

  /** Searches for flight options based on configured parameters. */
  public async searchFlights(): Promise<any | null> {
    if (!this.ORIGIN_ID || !this.DESTINATION_ID) {
      console.log(
        "❌ Cannot search flights: Origin ID or Destination ID is missing.",
      );
      return null;
    }

    const params = new URLSearchParams({
      fromId: this.ORIGIN_ID,
      toId: this.DESTINATION_ID,
      stops: this.STOPS,
      pageNo: this.PAGE_NO.toString(),
      adults: this.ADULTS.toString(),
      children: this.CHILDREN_AGES, // already URL-encoded in constructor
      sort: this.SORT_BY,
      cabinClass: this.CABIN_CLASS,
      currency_code: this.CURRENCY_CODE,
      departDate: this.DEPARTURE_DATE,
    });

    const flightEndpoint = `/api/v1/flights/searchFlights?${params.toString()}`;
    const flightDataDict = await this._makeApiCall("GET", flightEndpoint);

    if (
      flightDataDict &&
      flightDataDict.data &&
      flightDataDict.data.flightOffers
    ) {
      const totalCount =
        flightDataDict.data.aggregation?.totalCount ?? 0;
      console.log(
        `✅ Flight Search Success: Found **${totalCount}** flight offers.`,
      );
      return flightDataDict;
    } else {
      console.log("❌ Failed to get flight search data or no flights found.");
      return null;
    }
  }
}

// --- Helper function to parse and display/extract flight data ---
/** Parses the API response to return a clean FlightOffer object. */
export function parseFlightOffers(response_data: any): FlightOffer[] {
    if (!response_data || !response_data.data) {
        return [];
    }

    const flightData = response_data.data;
    const flightOffers: any[] = flightData.flightOffers ?? [];
    const carriersData = Object.fromEntries(
        (flightData.aggregation?.airlines ?? []).map((c: any) => [c.iataCode, c])
    );

    if (!flightOffers.length) {
        return [];
    }

    const cleanOffers: FlightOffer[] = [];

    for (const offer of flightOffers) {
        const segments = offer.segments ?? [{}];
        const priceBreakdown = offer.priceBreakdown ?? {};
        const total_price_obj = priceBreakdown.totalRounded ?? {};
        
        // Convert price object to a clean number (e.g., units + nanos/10^9)
        let price = total_price_obj.units ?? 0;
        const nanos = total_price_obj.nanos ?? 0;
        price += nanos / 1_000_000_000;

        const currency = total_price_obj.currencyCode ?? "N/A";
        
        const firstSegment = segments[0];
        const firstLeg = firstSegment?.legs?.[0];
        
        let summary = "N/A";
        if (firstLeg) {
            const carrierCode = firstLeg.flightInfo?.carrierInfo?.marketingCarrier ?? 'N/A';
            const airlineName = carriersData[carrierCode]?.name ?? 'Unknown Airline';
            const depAirport = firstLeg.departureAirport?.code ?? '???';
            const arrAirport = firstLeg.arrivalAirport?.code ?? '???';
            const stops = (firstSegment.legs?.length ?? 1) - 1;

            summary = `Operated by ${airlineName}, flying from ${depAirport} to ${arrAirport} with ${stops} stop(s).`;
        }

        cleanOffers.push({
            price: parseFloat(price.toFixed(2)),
            currency: currency,
            token: offer.token ?? "N/A",
            tripType: offer.tripType ?? "N/A",
            segments: segments, // Retain for deep inspection
            summary: summary
        });
    }

    return cleanOffers;
}