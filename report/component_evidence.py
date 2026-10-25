"""Produce raw component tables from the checked-in HEMS implementations."""
from pathlib import Path
import json
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
REPORT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "Output 3C"))

from fuzzy_controller import predict_ac_mode  # noqa: E402


def bayes(prior: float, motion: bool, p_mo_occ: float = 0.9, p_mo_empty: float = 0.05) -> tuple[float, float]:
    likelihood = p_mo_occ if motion else 1 - p_mo_occ
    false_likelihood = p_mo_empty if motion else 1 - p_mo_empty
    denominator = likelihood * prior + false_likelihood * (1 - prior)
    posterior = likelihood * prior / denominator
    return posterior, posterior * 100


def main() -> None:
    config = json.loads((ROOT / "HEMS_Phase3A_Artifacts/occupancy_config.json").read_text())
    rows = []
    for period, prior in config["time_periods"].items():
        for motion in [False, True]:
            posterior, percentage = bayes(prior, motion, config["p_motion_given_occupied"], config["p_motion_given_empty"])
            rows.append({"time_period": period, "motion_detected": motion, "prior": prior, "posterior": posterior, "percentage": percentage})
    occupancy = pd.DataFrame(rows)
    occupancy.to_csv(REPORT / "evidence/occupancy_table.csv", index=False)
    print("OCCUPANCY_TABLE")
    print(occupancy.to_string(index=False))

    inputs = [(25, 50, 5), (26, 50, 90), (30, 50, 90), (32, 70, 90), (42, 60, 95), (34, 64, 80), (34, 65, 80), (38, 40, 90)]
    fuzzy = pd.DataFrame([predict_ac_mode(*item) for item in inputs])
    fuzzy.to_csv(REPORT / "evidence/fuzzy_table.csv", index=False)
    print("FUZZY_TABLE")
    print(fuzzy.to_string(index=False))
    print("FUZZY_RULES")
    rules = [
        "occupancy low -> off",
        "occupancy medium AND temperature low -> off",
        "occupancy medium AND temperature moderate -> low",
        "occupancy medium AND temperature high -> high",
        "occupancy medium AND temperature very_high -> maximum",
        "occupancy high AND temperature low -> off",
        "occupancy high AND temperature moderate -> medium",
        "occupancy high AND temperature high -> high",
        "occupancy high AND temperature very_high -> maximum",
        "occupancy high AND humidity high AND temperature moderate -> high",
        "occupancy high AND humidity high AND temperature high -> maximum",
        "occupancy low AND temperature very_high -> low",
    ]
    print("\n".join(f"{i}. {rule}" for i, rule in enumerate(rules, 1)))


if __name__ == "__main__":
    main()
