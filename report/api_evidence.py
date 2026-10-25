"""Call live FastAPI endpoints and save reproducible tables."""
from pathlib import Path
import json
from urllib.request import Request, urlopen

import pandas as pd

REPORT = Path(__file__).resolve().parent
BASE = "http://127.0.0.1:8000"


def post(path: str, payload: object) -> tuple[int, object]:
    req = Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req) as response:
            return response.status, json.loads(response.read())
    except Exception as exc:
        return getattr(exc, "code", 0), json.loads(exc.read()) if hasattr(exc, "read") else str(exc)


def main() -> None:
    commands = [
        ("turn on the AC", "power_control"),
        ("switch off the fan", "power_control"),
        ("set the AC to eco mode", "set_mode"),
        ("maximum cooling for the AC", "set_mode"),
        ("dehumidify the air conditioner", "set_mode"),
        ("save energy while I am away", "energy_saving"),
        ("save electricity", "energy_saving"),
        ("play music", "unknown"),
        ("turn on and turn off the AC", "ambiguous"),
        ("turn on the refrigerator", "power_control"),
    ]
    nlp_rows = []
    nlp_raw = []
    for command, expected in commands:
        status, body = post("/commands/parse", {"command": command})
        passed = status == 200 and body.get("intent") == expected
        row = {
            "command": command,
            "intent": body.get("intent"),
            "appliance": body.get("appliance"),
            "value": body.get("value"),
            "confidence": body.get("confidence"),
            "needs_clarification": body.get("needs_clarification"),
            "expected_intent": expected,
            "pass": passed,
        }
        nlp_rows.append(row)
        nlp_raw.append({"command": command, "status": status, "response": body})
    (REPORT / "evidence/nlp_raw.json").write_text(json.dumps(nlp_raw, indent=2))
    pd.DataFrame(nlp_rows).to_csv(REPORT / "evidence/nlp_table.csv", index=False)
    print("NLP_TABLE")
    print(pd.DataFrame(nlp_rows).to_string(index=False))

    cases = [
        ("T1", "GET /health", None, 200),
        ("T2", "POST /predict/ac", {"ambient_temp": 32, "relative_humidity": 70, "motion_sensor": 1, "grid_power": 0.8, "hour": 14, "day_of_week": 3}, 200),
        ("T3", "POST /occupancy/estimate", {"timestamp": "morning", "motion_detected": True}, 200),
        ("T4", "POST /commands/parse", {"command": "turn on the AC"}, 200),
        ("T5", "POST /control/fuzzy", {"temperature_c": 32, "humidity_pct": 70, "occupancy_pct": 90}, 200),
        ("T6", "POST /recommendation", {"temperature_c": 27, "humidity_pct": 70, "occupancy_pct": 90}, 200),
        ("T7", "POST /predict/ac", {"ambient_temp": 46, "relative_humidity": 70, "motion_sensor": 1, "grid_power": 0.8, "hour": 14, "day_of_week": 3}, 422),
        ("T8", "POST /control/fuzzy", {"temperature_c": 32, "humidity_pct": 101, "occupancy_pct": 90}, 422),
    ]
    test_rows = []
    raw = []
    for case_id, endpoint, payload, expected in cases:
        method, path = endpoint.split(" ", 1)
        if method == "GET":
            with urlopen(BASE + path) as response:
                status, body = response.status, json.loads(response.read())
        else:
            status, body = post(path, payload)
        passed = status == expected
        test_rows.append({"id": case_id, "endpoint": endpoint, "input": payload, "expected": expected, "actual": status, "pass": passed})
        raw.append({"id": case_id, "endpoint": endpoint, "payload": payload, "status": status, "response": body})
    (REPORT / "evidence/curl_raw.json").write_text(json.dumps(raw, indent=2))
    pd.DataFrame(test_rows).to_csv(REPORT / "evidence/curl_test_table.csv", index=False)
    print("CURL_TEST_TABLE")
    print(pd.DataFrame(test_rows).to_string(index=False))

    scenarios = []
    for temp in range(20, 41):
        for humidity in (50, 80):
            rf_status, rf = post("/predict/ac", {"ambient_temp": temp, "relative_humidity": humidity, "motion_sensor": 1, "grid_power": 1, "hour": 12, "day_of_week": 1})
            occ_status, occ = post("/occupancy/estimate", {"timestamp": "afternoon", "motion_detected": True})
            fuzzy_status, fuzzy = post("/control/fuzzy", {"temperature_c": temp, "humidity_pct": humidity, "occupancy_pct": occ["occupancy_percentage"]})
            rule = "Off" if temp < 25 else "Eco" if temp < 32 else "Dry" if temp < 38 else "Max Cool"
            scenarios.append({"temperature": temp, "humidity": humidity, "rf": rf["predicted_mode"], "fuzzy": fuzzy["suggested_mode"], "temperature_rule": rule, "occupancy_percentage": occ["occupancy_percentage"], "statuses": f"{rf_status}/{occ_status}/{fuzzy_status}"})
    comparison = pd.DataFrame(scenarios)
    comparison.to_csv(REPORT / "evidence/comparison_table.csv", index=False)
    print("COMPARISON_ROWS", len(comparison))
    for left, right in [("rf", "fuzzy"), ("rf", "temperature_rule"), ("fuzzy", "temperature_rule")]:
        print(f"AGREEMENT_{left}_VS_{right}", (comparison[left] == comparison[right]).mean())
    print(comparison.to_string(index=False))


if __name__ == "__main__":
    main()
