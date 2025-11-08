// --- File: bookingClient.ts ---

// Helper function to safely get environment variables
function getEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}

// Define the structure for the options we pass in
interface BookingOptions {
  CITY_QUERY: string;
  ARRIVAL_DATE: string;
  DEPARTURE_DATE: string;
  ADULTS?: number;
  CHILDREN_AGE?: string; // e.g., "0,17"
  ROOM_QTY?: number;
  PRICE_MIN?: number;
  PRICE_MAX?: number;
}

// Define the structure of the final data we want to return
export interface HotelResult {
  destination: string;
  hotel_name: string;
  hotel_description: string;
  price: number;
  currency: string;
  booking_hotel_id: number;
  hotel_photo_url: string[];
  room_photo_url: string;
}

/**
 * A class to interact with the Booking.com RapidAPI endpoint,
 * translated from the Python version.
 */
export class BookingComAPI {
  private API_HOST: string;
  private API_KEY: string;
  private HEADERS: HeadersInit;

  // Search Parameters
  private CITY_QUERY: string;
  private ARRIVAL_DATE: string;
  private DEPARTURE_DATE: string;
  private ADULTS: number;
  private CHILDREN_AGE: string;
  private ROOM_QTY: number;
  private PRICE_MIN: number;
  private PRICE_MAX: number;

  // Booking/Display Specific Variables
  private PAGE_NUMBER = 1;
  private UNITS = "metric";
  private TEMPERATURE_UNIT = "c";
  private LANGUAGE_CODE = "en-us";
  private CURRENCY_CODE = "EUR";
  private LOCATION = "NL";

  // Variables set dynamically
  private DEST_ID = "";
  private DESTINATION = "";
  private SEARCH_TYPE = "";

  constructor(apiHost: string, apiKey: string, options: BookingOptions) {
    this.API_HOST = apiHost;
    this.API_KEY = apiKey;
    this.HEADERS = {
      "x-rapidapi-key": this.API_KEY,
      "x-rapidapi-host": this.API_HOST,
    };

    // Set all parameters from the options object, with defaults
    this.CITY_QUERY = options.CITY_QUERY;
    this.ARRIVAL_DATE = options.ARRIVAL_DATE;
    this.DEPARTURE_DATE = options.DEPARTURE_DATE;
    this.ADULTS = options.ADULTS ?? 2;
    this.CHILDREN_AGE = options.CHILDREN_AGE?.replace(/,/g, "%2C") ?? "0%2C17"; // URL-encode commas
    this.ROOM_QTY = options.ROOM_QTY ?? 1;
    this.PRICE_MIN = options.PRICE_MIN ?? 0;
    this.PRICE_MAX = options.PRICE_MAX ?? 1000;
  }

  public getDestinationName(): string {
    return this.DESTINATION;
  }
  
  /** Handles the connection and makes the API request. */
  private async _makeApiCall(
    method: string,
    endpoint: string,
  ): Promise<any | null> {
    const url = `https:///${this.API_HOST}${endpoint}`;
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

      const data = await response.json();
      return data;
    } catch (e) {
      console.error(`An error occurred: ${e.message}`);
      return null;
    }
  }

  /** Finds the destination ID and search type based on CITY_QUERY. */
  async searchDestination(): Promise<boolean> {
    const cityEndpoint =
      `/api/v1/hotels/searchDestination?query=${encodeURIComponent(
        this.CITY_QUERY,
      )}`;
    const cityDataDict = await this._makeApiCall("GET", cityEndpoint);

    if (cityDataDict && cityDataDict.data && cityDataDict.data.length > 0) {
      const firstResult = cityDataDict.data[0];
      this.DEST_ID = firstResult.dest_id;
      this.DESTINATION = firstResult.label;
      this.SEARCH_TYPE = firstResult.search_type?.toUpperCase() ?? "";

      console.log(
        `✅ City Search Success: Using '${this.DESTINATION}'`,
      );
      console.log(
        `   -> DEST_ID: ${this.DEST_ID}, SEARCH_TYPE: ${this.SEARCH_TYPE}`,
      );
      return true;
    } else {
      console.log(
        `❌ City Search Failed: No results found for '${this.CITY_QUERY}'.`,
      );
      return false;
    }
  }

  /** Retrieves filter data, including the total number of hotels. */
  async getFilters(): Promise<any | null> {
    if (!this.DEST_ID || !this.SEARCH_TYPE) {
      console.log(
        "❌ Cannot get filters: Destination ID or Search Type is missing.",
      );
      return null;
    }

    // Use URLSearchParams to build the query string easily
    const params = new URLSearchParams({
      dest_id: this.DEST_ID,
      search_type: this.SEARCH_TYPE,
      arrival_date: this.ARRIVAL_DATE,
      departure_date: this.DEPARTURE_DATE,
      adults: this.ADULTS.toString(),
      children_age: this.CHILDREN_AGE,
      room_qty: this.ROOM_QTY.toString(),
    });

    const filterEndpoint = `/api/v1/hotels/getFilter?${params.toString()}`;
    const filterDataDict = await this._makeApiCall("GET", filterEndpoint);

    if (filterDataDict && filterDataDict.data) {
      const totalHotels =
        filterDataDict.data.pagination?.nbResultsTotal ?? "N/A";
      console.log(
        `✅ Filter Data Retrieved. Total Hotels Available for dates ${this.ARRIVAL_DATE} to ${this.DEPARTURE_DATE}: ${totalHotels}`,
      );
      return filterDataDict;
    } else {
      console.log("❌ Failed to get filter data.");
      return null;
    }
  }

  /** Searches for hotels based on all configured parameters. */
  async searchHotels(): Promise<any | null> {
    if (!this.DEST_ID || !this.SEARCH_TYPE) {
      console.log(
        "❌ Cannot search hotels: Destination ID or Search Type is missing.",
      );
      return null;
    }

    const params = new URLSearchParams({
      dest_id: this.DEST_ID,
      search_type: this.SEARCH_TYPE,
      arrival_date: this.ARRIVAL_DATE,
      departure_date: this.DEPARTURE_DATE,
      adults: this.ADULTS.toString(),
      children_age: this.CHILDREN_AGE,
      room_qty: this.ROOM_QTY.toString(),
      page_number: this.PAGE_NUMBER.toString(),
      price_min: this.PRICE_MIN.toString(),
      price_max: this.PRICE_MAX.toString(),
      units: this.UNITS,
      temperature_unit: this.TEMPERATURE_UNIT,
      languagecode: this.LANGUAGE_CODE,
      currency_code: this.CURRENCY_CODE,
      location: this.LOCATION,
    });

    const hotelEndpoint = `/api/v1/hotels/searchHotels?${params.toString()}`;
    const hotelDataDict = await this._makeApiCall("GET", hotelEndpoint);

    if (hotelDataDict && hotelDataDict.data) {
      const hotelCount = hotelDataDict.data.hotels?.length ?? 0;
      console.log(
        `✅ Hotel Search Results Retrieved: ${hotelCount} hotels on page ${this.PAGE_NUMBER}.`,
      );
      return hotelDataDict;
    } else {
      console.log("❌ Failed to get hotel search data.");
      return null;
    }
  }

  /** Retrieves specific details for a single hotel, including room photos. */
  async getHotelDetails(hotelId: number): Promise<any | null> {
    const params = new URLSearchParams({
      hotel_id: hotelId.toString(),
      adults: this.ADULTS.toString(),
      children_age: this.CHILDREN_AGE,
      room_qty: this.ROOM_QTY.toString(),
      units: this.UNITS,
      arrival_date: this.ARRIVAL_DATE,
      departure_date: this.DEPARTURE_DATE,
      temperature_unit: this.TEMPERATURE_UNIT,
      languagecode: this.LANGUAGE_CODE,
      currency_code: this.CURRENCY_CODE,
    });

    const detailsEndpoint =
      `/api/v1/hotels/getHotelDetails?${params.toString()}`;
    const detailsDataDict = await this._makeApiCall("GET", detailsEndpoint);

    if (detailsDataDict && detailsDataDict.data) {
      console.log(`✅ Hotel Details Retrieved for hotel ID: **${hotelId}**`);
      return detailsDataDict;
    } else {
      console.log(`❌ Failed to get hotel details for hotel ID: ${hotelId}.`);
      return null;
    }
  }
}