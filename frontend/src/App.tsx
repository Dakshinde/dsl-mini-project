import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  checkHealth,
  clamp,
  evaluate,
  fetchHourlyForecast,
  fetchMumbaiWeather,
  periodOf,
  planDay,
} from "./api";
import type { HourForecast, HourPlan } from "./api";
import type { Inputs, Verdict } from "./types";

/* ---------- static knowledge taken from the backend audit ---------- */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const IMPORTANCE = [
  { name: "Temperature", value: 0.3071 },
  { name: "Hour of day", value: 0.3066 },
  { name: "Humidity", value: 0.2772 },
  { name: "Grid power", value: 0.0996 },
  { name: "Day of week", value: 0.0073 },
  { name: "Motion", value: 0.0022 },
];

type Trap = [number, number, number, number];
const TEMP_MF: Record<string, Trap> = {
  low: [15, 15, 20, 24],
  moderate: [21, 27, 27, 33],
  high: [29, 35, 35, 40],
  very_high: [36, 40, 45, 45],
};
const HUM_MF: Record<string, Trap> = {
  low: [0, 0, 25, 40],
  normal: [30, 50, 50, 70],
  high: [60, 75, 100, 100],
};
const LINE_COLORS = ["#1f5fc4", "#2f7d4f", "#b36b00", "#a23b72"];

// Training data range, so the Lab can warn about extrapolation.
const TRAINED = { tMin: 17.45, tMax: 38.86, hMin: 40, hMax: 93.28 };

function mu(x: number, [a, b, c, d]: Trap): number {
  if (x < a || x > d) return 0;
  if (x < b) return (x - a) / (b - a);
  if (x <= c) return 1;
  return (d - x) / (d - c);
}

function mfData(defs: Record<string, Trap>, min: number, max: number, step: number) {
  const rows: Record<string, number>[] = [];
  for (let x = min; x <= max; x += step) {
    const row: Record<string, number> = { x };
    for (const k of Object.keys(defs)) row[k] = Number(mu(x, defs[k]).toFixed(3));
    rows.push(row);
  }
  return rows;
}

/* ---------- small helpers ---------- */

function useVerdict(inputs: Inputs, delay = 300) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const id = window.setTimeout(() => {
      evaluate(inputs)
        .then((v) => {
          if (cancelled) return;
          setVerdict(v);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "Request failed");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [inputs, delay]);

  return { verdict, error, loading };
}

function Chip({ mode }: { mode: string }) {
  return (
    <span className="chip" data-mode={mode}>
      {mode}
    </span>
  );
}

function reasonFor(v: Verdict, i: Inputs): string {
  const t = i.temp.toFixed(1);
  const h = Math.round(i.humidity);
  const d = v.fuzzy.cooling_demand.toFixed(0);
  const occ = Math.round(v.occ.occupancy_percentage);
  switch (v.fuzzy.suggested_mode) {
    case "Off":
      return `Cooling demand is only ${d} out of 100 at ${t}°C, and there is about a ${occ}% chance someone is in the room. Leaving the AC off saves the most power.`;
    case "Dry":
      return `At ${t}°C the air feels heavy mostly because of the ${h}% humidity. Dry mode removes moisture without overcooling the room.`;
    case "Max Cool":
      return `It is ${t}°C with a cooling demand of ${d} out of 100 and about a ${occ}% chance the room is occupied. This is hot enough that full cooling is justified.`;
    default:
      return `It is warm (${t}°C) and cooling demand is ${d} out of 100, but not high enough for full cooling. Eco mode keeps the room comfortable with less power.`;
  }
}

/* ---------- feedback (browser storage, exported as CSV) ---------- */

const FB_KEY = "hems-feedback";
interface FeedbackRow {
  time: string;
  temp: number;
  humidity: number;
  motion: boolean;
  grid: boolean;
  hour: number;
  dow: number;
  fuzzy: string;
  rf: string;
  rule: string;
  helpful: boolean;
}

function readFeedback(): FeedbackRow[] {
  try {
    return JSON.parse(localStorage.getItem(FB_KEY) ?? "[]") as FeedbackRow[];
  } catch {
    return [];
  }
}

function saveFeedback(row: FeedbackRow): number {
  const all = [...readFeedback(), row];
  try {
    localStorage.setItem(FB_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: feedback is simply not kept */
  }
  return all.length;
}

function downloadFeedbackCsv() {
  const rows = readFeedback();
  if (rows.length === 0) return;
  const head = Object.keys(rows[0]).join(",");
  const body = rows.map((r) => Object.values(r).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([`${head}\n${body}`], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "hems-feedback.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function Feedback({ verdict, inputs }: { verdict: Verdict; inputs: Inputs }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => setCount(null), [verdict]);

  const send = (helpful: boolean) =>
    setCount(
      saveFeedback({
        time: new Date().toISOString(),
        temp: inputs.temp,
        humidity: inputs.humidity,
        motion: inputs.motion,
        grid: inputs.grid,
        hour: inputs.hour,
        dow: inputs.dow,
        fuzzy: verdict.fuzzy.suggested_mode,
        rf: verdict.rf.predicted_mode,
        rule: verdict.rule,
        helpful,
      }),
    );

  return (
    <div className="panel">
      <h3>Was this advice helpful?</h3>
      {count === null ? (
        <div className="row">
          <button className="btn" onClick={() => send(true)}>
            Yes, helpful
          </button>
          <button className="btn ghost" onClick={() => send(false)}>
            No, not helpful
          </button>
        </div>
      ) : (
        <div className="row">
          <span>Saved on this device. {count} answer{count === 1 ? "" : "s"} so far.</span>
          <button className="btn ghost" onClick={downloadFeedbackCsv}>
            Download feedback CSV
          </button>
        </div>
      )}
      <p className="muted">
        Real answers like these are the start of a non-synthetic dataset for retraining.
      </p>
    </div>
  );
}

/* ---------- constrained number input ---------- */

/**
 * Only in-range numbers reach the app state while typing; anything else is
 * flagged, and the value snaps to the nearest allowed number on blur.
 */
function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const parsed = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(parsed) && parsed >= min && parsed <= max;

  return (
    <label className="field">
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-invalid={!valid}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          const text = e.target.value.slice(0, 6);
          setDraft(text);
          const v = Number(text);
          if (text.trim() !== "" && Number.isFinite(v) && v >= min && v <= max) onChange(v);
        }}
        onBlur={() => {
          setFocused(false);
          const fixed =
            draft.trim() === "" || !Number.isFinite(parsed) ? value : clamp(parsed, min, max);
          onChange(fixed);
          setDraft(String(fixed));
        }}
      />
      <small className={valid ? "hint" : "hint bad"}>
        {valid ? `Allowed: ${min} to ${max}` : `Enter a number from ${min} to ${max}`}
      </small>
    </label>
  );
}

/* ---------- Advisor ---------- */

function Advisor() {
  const now = useMemo(() => new Date(), []);
  const [temp, setTemp] = useState(30);
  const [humidity, setHumidity] = useState(70);
  const [motion, setMotion] = useState(true);
  const [grid, setGrid] = useState(true);
  const [weatherNote, setWeatherNote] = useState("Loading Mumbai weather…");

  const loadWeather = async () => {
    setWeatherNote("Loading Mumbai weather…");
    try {
      const w = await fetchMumbaiWeather();
      setTemp(clamp(Number(w.temp.toFixed(1)), 15, 45));
      setHumidity(clamp(Math.round(w.humidity), 0, 100));
      setWeatherNote("Live outdoor weather in Mumbai (Open-Meteo)");
    } catch {
      setWeatherNote("Weather unavailable. Enter the values by hand.");
    }
  };

  useEffect(() => {
    void loadWeather();
  }, []);

  const inputs = useMemo<Inputs>(
    () => ({
      temp,
      humidity,
      motion,
      grid,
      hour: now.getHours(),
      dow: (now.getDay() + 6) % 7,
    }),
    [temp, humidity, motion, grid, now],
  );

  const { verdict, error, loading } = useVerdict(inputs);
  const modes = verdict
    ? [verdict.fuzzy.suggested_mode, verdict.rf.predicted_mode, verdict.rule]
    : [];
  const agree = modes.length > 0 && modes.every((m) => m === modes[0]);

  return (
    <>
      <section className="panel">
        <h3>Your room right now</h3>
        <div className="fields">
          <NumberField
            label="Temperature (°C)"
            value={temp}
            min={15}
            max={45}
            step={0.5}
            onChange={setTemp}
          />
          <NumberField
            label="Humidity (%)"
            value={humidity}
            min={0}
            max={100}
            step={1}
            onChange={setHumidity}
          />
          <label className="field check">
            <input type="checkbox" checked={motion} onChange={(e) => setMotion(e.target.checked)} />
            Someone is moving in the room
          </label>
          <label className="field check">
            <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
            Grid power is on
          </label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn ghost" onClick={() => void loadWeather()}>
            Refresh weather
          </button>
          <span className="muted">
            {weatherNote}. Outdoor values stand in for your room until you add a sensor.
          </span>
        </div>
      </section>

      {error && (
        <div className="alert bad" role="alert">
          Could not reach the backend. Start it with{" "}
          <code>python -m uvicorn HEMS.main:app --port 8000</code>. Details: {error}
        </div>
      )}

      {verdict && (
        <>
          <section className="verdict" data-mode={verdict.fuzzy.suggested_mode} aria-busy={loading}>
            <h2>
              {verdict.fuzzy.suggested_mode === "Off"
                ? "Keep the AC off"
                : `Run ${verdict.fuzzy.suggested_mode} mode`}
            </h2>
            <p>{reasonFor(verdict, inputs)}</p>
          </section>

          <div className="opinions">
            <div className="op">
              <small>Fuzzy controller (main advice)</small>
              <Chip mode={verdict.fuzzy.suggested_mode} />
              <small>Demand {verdict.fuzzy.cooling_demand.toFixed(0)} / 100</small>
            </div>
            <div className="op">
              <small>Random Forest (second opinion)</small>
              <Chip mode={verdict.rf.predicted_mode} />
              <small>
                {verdict.rf.probability !== null
                  ? `${Math.round(verdict.rf.probability * 100)}% confident`
                  : "confidence not available"}
              </small>
            </div>
            <div className="op">
              <small>Simple temperature rule</small>
              <Chip mode={verdict.rule} />
              <small>Uses temperature only</small>
            </div>
          </div>

          <div className={agree ? "alert agree" : "alert"}>
            {agree
              ? "All three methods agree."
              : "The methods disagree because they look at different things. The fuzzy controller weighs temperature, humidity and how likely the room is occupied. The Random Forest also uses the time of day and grid power, learned from simulated data. Treat the fuzzy result as the main advice."}
          </div>

          <Feedback verdict={verdict} inputs={inputs} />
        </>
      )}
    </>
  );
}

/* ---------- Planner ---------- */

type Schedule = "home" | "office" | "away";
const SCHEDULES: Record<Schedule, { label: string; isHome: (h: number) => boolean }> = {
  home: { label: "Home all day", isHome: () => true },
  office: { label: "Away 9 AM to 6 PM", isHome: (h) => h < 9 || h >= 18 },
  away: { label: "Away all day", isHome: () => false },
};

const fmtHour = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;

interface Block {
  mode: string;
  start: number;
  end: number;
  minT: number;
  maxT: number;
}

function groupBlocks(plans: HourPlan[]): Block[] {
  const blocks: Block[] = [];
  for (const p of plans) {
    const mode = p.verdict?.fuzzy.suggested_mode ?? "Unavailable";
    const last = blocks[blocks.length - 1];
    if (last && last.mode === mode) {
      last.end = (p.hour + 1) % 24;
      last.minT = Math.min(last.minT, p.temp);
      last.maxT = Math.max(last.maxT, p.temp);
    } else {
      blocks.push({ mode, start: p.hour, end: (p.hour + 1) % 24, minT: p.temp, maxT: p.temp });
    }
  }
  return blocks;
}

function Planner() {
  const [forecast, setForecast] = useState<HourForecast[] | null>(null);
  const [plans, setPlans] = useState<HourPlan[] | null>(null);
  const [schedule, setSchedule] = useState<Schedule>("home");
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setError(null);
    fetchHourlyForecast()
      .then(setForecast)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Could not load the forecast"),
      );
  }, [reload]);

  useEffect(() => {
    if (!forecast) return;
    let cancelled = false;
    setBusy(true);
    planDay(forecast, SCHEDULES[schedule].isHome)
      .then((p) => {
        if (!cancelled) setPlans(p);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [forecast, schedule]);

  const blocks = useMemo(() => (plans ? groupBlocks(plans) : []), [plans]);
  const answered = plans ? plans.filter((p) => p.verdict !== null) : [];
  const differ = answered.filter(
    (p) => p.verdict && p.verdict.rf.predicted_mode !== p.verdict.fuzzy.suggested_mode,
  ).length;
  const peak = plans ? Math.max(...plans.map((p) => p.temp)) : 0;

  return (
    <>
      <section className="panel">
        <h3>Your next 24 hours</h3>
        <div className="row">
          <label className="field" style={{ minWidth: 220 }}>
            Who is home?
            <select value={schedule} onChange={(e) => setSchedule(e.target.value as Schedule)}>
              {Object.entries(SCHEDULES).map(([k, s]) => (
                <option key={k} value={k}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn ghost" onClick={() => setReload((n) => n + 1)}>
            Refresh forecast
          </button>
        </div>
        <p className="muted">
          Uses the Mumbai hourly forecast from Open-Meteo (outdoor conditions). The schedule decides
          whether motion is assumed in the room; it is your guess, not a sensor reading.
        </p>
      </section>

      {error && (
        <div className="alert bad" role="alert">
          {error}
        </div>
      )}
      {plans && answered.length === 0 && (
        <div className="alert bad" role="alert">
          The backend did not answer. Start it on port 8000 and refresh the forecast.
        </div>
      )}

      {plans && answered.length > 0 && (
        <>
          <section className="panel" aria-busy={busy}>
            <h3>Hour by hour (fuzzy controller)</h3>
            <div className="strip-wrap">
              <div className="strip">
                {plans.map((p) => (
                  <div
                    key={p.time}
                    className="cell"
                    data-mode={p.verdict?.fuzzy.suggested_mode ?? "none"}
                    title={`${fmtHour(p.hour)}: ${Math.round(p.temp)}°C, ${p.humidity}% humidity`}
                  >
                    <small>{fmtHour(p.hour)}</small>
                    <b>{Math.round(p.temp)}°</b>
                    <small>{p.verdict?.fuzzy.suggested_mode ?? "n/a"}</small>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="panel">
            <h3>The plan</h3>
            <ul className="blocks">
              {blocks.map((b, idx) => (
                <li key={idx}>
                  <span className="when">
                    {fmtHour(b.start)} to {fmtHour(b.end)}
                  </span>
                  <Chip mode={b.mode} />
                  <span className="muted">
                    {Math.round(b.minT)}
                    {Math.round(b.minT) !== Math.round(b.maxT) && `–${Math.round(b.maxT)}`}°C
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted">
              Peak outdoor temperature: {Math.round(peak)}°C. The Random Forest disagreed with the
              fuzzy controller in {differ} of {answered.length} hours.
            </p>
          </section>
        </>
      )}
    </>
  );
}

/* ---------- Lab ---------- */

function MfChart({
  title,
  defs,
  min,
  max,
  step,
  current,
  unit,
}: {
  title: string;
  defs: Record<string, Trap>;
  min: number;
  max: number;
  step: number;
  current: number;
  unit: string;
}) {
  const data = useMemo(() => mfData(defs, min, max, step), [defs, min, max, step]);
  return (
    <div className="panel">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#d6e0de" strokeDasharray="3 3" />
          <XAxis dataKey="x" type="number" domain={[min, max]} unit={unit} />
          <YAxis domain={[0, 1]} width={32} />
          <Tooltip />
          <Legend />
          <ReferenceLine x={current} stroke="#0f2027" strokeWidth={2} />
          {Object.keys(defs).map((k, idx) => (
            <Line
              key={k}
              dataKey={k}
              dot={false}
              stroke={LINE_COLORS[idx % LINE_COLORS.length]}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Lab() {
  const [inputs, setInputs] = useState<Inputs>({
    temp: 32,
    humidity: 70,
    motion: true,
    grid: true,
    hour: 14,
    dow: 3,
  });
  const set = <K extends keyof Inputs>(k: K, v: Inputs[K]) =>
    setInputs((p) => ({ ...p, [k]: v }));

  const { verdict, error } = useVerdict(inputs, 250);
  const outside =
    inputs.temp < TRAINED.tMin ||
    inputs.temp > TRAINED.tMax ||
    inputs.humidity < TRAINED.hMin ||
    inputs.humidity > TRAINED.hMax;
  const modes = verdict
    ? [verdict.fuzzy.suggested_mode, verdict.rf.predicted_mode, verdict.rule]
    : [];
  const agree = modes.length > 0 && modes.every((m) => m === modes[0]);

  return (
    <div className="lab">
      <section className="panel">
        <h3>Inputs</h3>
        <div className="fields" style={{ gridTemplateColumns: "1fr" }}>
          <label className="field">
            Temperature: {inputs.temp.toFixed(1)} °C
            <input
              type="range"
              min={15}
              max={45}
              step={0.5}
              value={inputs.temp}
              onChange={(e) => set("temp", Number(e.target.value))}
            />
          </label>
          <label className="field">
            Humidity: {inputs.humidity}%
            <input
              type="range"
              min={0}
              max={100}
              value={inputs.humidity}
              onChange={(e) => set("humidity", Number(e.target.value))}
            />
          </label>
          <label className="field">
            Hour: {inputs.hour}:00 ({periodOf(inputs.hour)})
            <input
              type="range"
              min={0}
              max={23}
              value={inputs.hour}
              onChange={(e) => set("hour", Number(e.target.value))}
            />
          </label>
          <label className="field">
            Day of week
            <select value={inputs.dow} onChange={(e) => set("dow", Number(e.target.value))}>
              {DAYS.map((d, idx) => (
                <option key={d} value={idx}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="field check">
            <input
              type="checkbox"
              checked={inputs.motion}
              onChange={(e) => set("motion", e.target.checked)}
            />
            Motion detected
          </label>
          <label className="field check">
            <input
              type="checkbox"
              checked={inputs.grid}
              onChange={(e) => set("grid", e.target.checked)}
            />
            Grid power on
          </label>
        </div>
      </section>

      <div>
        {error && (
          <div className="alert bad" role="alert">
            Backend error: {error}
          </div>
        )}
        {outside && (
          <div className="alert">
            These values are outside the data the Random Forest was trained on (
            {TRAINED.tMin}–{TRAINED.tMax} °C, {TRAINED.hMin}–{Math.round(TRAINED.hMax)}% humidity), so
            its answer is an extrapolation.
          </div>
        )}
        {verdict && (
          <>
            <div className={agree ? "alert agree" : "alert"}>
              {agree
                ? "All three methods agree on this input."
                : "The methods disagree on this input. Move the sliders to find where they switch."}
            </div>
            <div className="tiles">
              <div className="tile" data-mode={verdict.rf.predicted_mode}>
                <small>Random Forest</small>
                <div className="big">{verdict.rf.predicted_mode}</div>
                <small>
                  Class {verdict.rf.predicted_mode_code}
                  {verdict.rf.probability !== null &&
                    `, ${Math.round(verdict.rf.probability * 100)}% of trees agree`}
                </small>
              </div>
              <div className="tile" data-mode={verdict.fuzzy.suggested_mode}>
                <small>Fuzzy controller</small>
                <div className="big">{verdict.fuzzy.suggested_mode}</div>
                <small>Cooling demand {verdict.fuzzy.cooling_demand.toFixed(1)} / 100</small>
              </div>
              <div className="tile">
                <small>Bayesian occupancy ({verdict.occ.time_period})</small>
                <div className="big">{verdict.occ.occupancy_percentage.toFixed(1)}%</div>
                <small>
                  {verdict.occ.likely_occupied ? "Likely occupied" : "Likely empty"}. Illustrative
                  probabilities.
                </small>
              </div>
              <div className="tile" data-mode={verdict.rule}>
                <small>Temperature rule</small>
                <div className="big">{verdict.rule}</div>
                <small>Below 25 Off, 25–32 Eco, 32–38 Dry, 38+ Max Cool</small>
              </div>
            </div>
          </>
        )}

        <div className="panel">
          <h3>What the Random Forest pays attention to</h3>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={IMPORTANCE} layout="vertical" margin={{ left: 20, right: 16 }}>
              <CartesianGrid stroke="#d6e0de" strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 0.35]} />
              <YAxis type="category" dataKey="name" width={100} />
              <Tooltip />
              <Bar dataKey="value" fill="#0e5a64" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <p className="muted">
            Hour of day matters as much as temperature. That reflects how the simulated training
            data was built, not a proven real-world effect.
          </p>
        </div>

        <MfChart
          title="Fuzzy temperature sets (black line = your input)"
          defs={TEMP_MF}
          min={15}
          max={45}
          step={0.5}
          current={inputs.temp}
          unit="°"
        />
        <MfChart
          title="Fuzzy humidity sets"
          defs={HUM_MF}
          min={0}
          max={100}
          step={1}
          current={inputs.humidity}
          unit="%"
        />
      </div>
    </div>
  );
}

/* ---------- shell ---------- */

export default function App() {
  const [tab, setTab] = useState<"advisor" | "planner" | "lab">("advisor");
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    void checkHealth().then(setOnline);
  }, []);

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <h1>HEMS AC Advisor</h1>
          <p>Comfort without wasted electricity, for humid cities</p>
        </div>
        <span className={online === false ? "status bad" : "status"}>
          {online === null
            ? "Checking backend…"
            : online
              ? "Backend connected"
              : "Backend not reachable"}
        </span>
      </header>

      <nav className="tabs" role="tablist" aria-label="Sections">
        <button role="tab" aria-selected={tab === "advisor"} onClick={() => setTab("advisor")}>
          Advisor
        </button>
        <button role="tab" aria-selected={tab === "planner"} onClick={() => setTab("planner")}>
          Planner
        </button>
        <button role="tab" aria-selected={tab === "lab"} onClick={() => setTab("lab")}>
          ML Lab
        </button>
      </nav>

      <main>{tab === "advisor" ? <Advisor /> : tab === "planner" ? <Planner /> : <Lab />}</main>

      <p className="foot">
        Prototype for decision support. The Random Forest was trained on simulated data, and the
        fuzzy rules and occupancy probabilities are unvalidated estimates. This app gives advice
        only; it does not control any appliance, and energy savings have not been measured.
      </p>
    </div>
  );
}