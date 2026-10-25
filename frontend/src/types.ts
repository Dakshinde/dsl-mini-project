export type Mode = "Off" | "Eco" | "Dry" | "Max Cool";

export interface Inputs {
  temp: number; // °C
  humidity: number; // %
  motion: boolean;
  grid: boolean; // dataset stores grid_power as 0 or 1
  hour: number; // 0-23
  dow: number; // 0 = Monday ... 6 = Sunday
}

export interface RfResponse {
  predicted_mode: string;
  predicted_mode_code: number;
  probability: number | null;
}

export interface OccResponse {
  time_period: string;
  occupancy_probability: number;
  occupancy_percentage: number;
  likely_occupied: boolean;
  provisional_note: string;
}

export interface FuzzyResponse {
  cooling_demand: number;
  suggested_mode: string;
  model_note: string;
}

export interface Verdict {
  rf: RfResponse;
  occ: OccResponse;
  fuzzy: FuzzyResponse;
  rule: Mode;
}
