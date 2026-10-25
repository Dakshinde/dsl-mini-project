import type {
  FuzzyResponse,
  Inputs,
  Mode,
  OccResponse,
  RfResponse,
  Verdict,
} from "./types";

const API_BASE: string =
  import.meta.env.VITE_HEMS_API_URL ?? "http://127.0.0.1:8000";

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/** The backend matches period words, not clock times, so send words. */
export function periodOf(hour: number): string {
  if (hour >= 5 && hour <= 11) return "morning";
  if (hour >= 12 && hour <= 16) return "afternoon";
  if (hour >= 17 && hour <= 20) return "evening";
  return "night";
}

/** Same thresholds the backend's /recommendation endpoint uses (temperature only). */
export function ruleMode(tempC: number): Mode {
  if (tempC >= 38) return "Max Cool";
  if (tempC >= 32) return "Dry";
  if (tempC >= 25) return "Eco";
  return "Off";
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} returned ${res.status}: ${text.slice(0, 160)}`);
  }
  return (await res.json()) as T;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Runs the three models. Occupancy goes first because the fuzzy controller
 * needs its percentage; the Random Forest runs in parallel with it.
 */
export async function evaluate(i: Inputs): Promise<Verdict> {
  const temp = clamp(i.temp, 15, 45);
  const humidity = clamp(i.humidity, 0, 100);

  const [rf, occ] = await Promise.all([
    post<RfResponse>("/predict/ac", {
      ambient_temp: temp,
      relative_humidity: humidity,
      motion_sensor: i.motion ? 1 : 0,
      grid_power: i.grid ? 1 : 0,
      hour: Math.round(clamp(i.hour, 0, 23)),
      day_of_week: Math.round(clamp(i.dow, 0, 6)),
    }),
    post<OccResponse>("/occupancy/estimate", {
      timestamp: periodOf(i.hour),
      motion_detected: i.motion,
    }),
  ]);

  const fuzzy = await post<FuzzyResponse>("/control/fuzzy", {
    temperature_c: temp,
    humidity_pct: humidity,
    occupancy_pct: clamp(occ.occupancy_percentage, 0, 100),
  });

  return { rf, occ, fuzzy, rule: ruleMode(temp) };
}

interface MeteoResponse {
  current: { temperature_2m: number; relative_humidity_2m: number };
}

export async function fetchMumbaiWeather(): Promise<{
  temp: number;
  humidity: number;
}> {
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=19.076&longitude=72.8777" +
    "&current=temperature_2m,relative_humidity_2m&timezone=Asia%2FKolkata";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather request failed (${res.status})`);
  const data = (await res.json()) as MeteoResponse;
  return {
    temp: data.current.temperature_2m,
    humidity: data.current.relative_humidity_2m,
  };
}
