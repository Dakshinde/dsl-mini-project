
import numpy as np
import skfuzzy as fuzz
from skfuzzy import control as ctrl


def select_ac_mode(temperature_c, humidity_pct, demand):
    """Map temperature, humidity, and cooling demand to a provisional AC mode."""
    if demand < 15:
        return "Off"
    if humidity_pct >= 65 and temperature_c < 35:
        return "Dry"
    if temperature_c >= 38 or demand >= 65:
        return "Max Cool"
    return "Eco"


def build_controller():
    temperature = ctrl.Antecedent(np.arange(15, 46, 1), "temperature")
    humidity = ctrl.Antecedent(np.arange(0, 101, 1), "humidity")
    occupancy = ctrl.Antecedent(np.arange(0, 101, 1), "occupancy")
    cooling_demand = ctrl.Consequent(
        np.arange(0, 101, 1), "cooling_demand"
    )

    temperature["low"] = fuzz.trapmf(
        temperature.universe, [15, 15, 20, 24]
    )
    temperature["moderate"] = fuzz.trimf(
        temperature.universe, [21, 27, 33]
    )
    temperature["high"] = fuzz.trimf(
        temperature.universe, [29, 35, 40]
    )
    temperature["very_high"] = fuzz.trapmf(
        temperature.universe, [36, 40, 45, 45]
    )

    humidity["low"] = fuzz.trapmf(
        humidity.universe, [0, 0, 25, 40]
    )
    humidity["normal"] = fuzz.trimf(
        humidity.universe, [30, 50, 70]
    )
    humidity["high"] = fuzz.trapmf(
        humidity.universe, [60, 75, 100, 100]
    )

    occupancy["low"] = fuzz.trapmf(
        occupancy.universe, [0, 0, 15, 35]
    )
    occupancy["medium"] = fuzz.trimf(
        occupancy.universe, [20, 50, 80]
    )
    occupancy["high"] = fuzz.trapmf(
        occupancy.universe, [65, 85, 100, 100]
    )

    cooling_demand["off"] = fuzz.trapmf(
        cooling_demand.universe, [0, 0, 5, 15]
    )
    cooling_demand["low"] = fuzz.trimf(
        cooling_demand.universe, [10, 25, 40]
    )
    cooling_demand["medium"] = fuzz.trimf(
        cooling_demand.universe, [30, 45, 60]
    )
    cooling_demand["high"] = fuzz.trimf(
        cooling_demand.universe, [50, 70, 85]
    )
    cooling_demand["maximum"] = fuzz.trapmf(
        cooling_demand.universe, [75, 90, 100, 100]
    )

    rules = [
        ctrl.Rule(occupancy["low"], cooling_demand["off"]),
        ctrl.Rule(
            occupancy["medium"] & temperature["low"],
            cooling_demand["off"]
        ),
        ctrl.Rule(
            occupancy["medium"] & temperature["moderate"],
            cooling_demand["low"]
        ),
        ctrl.Rule(
            occupancy["medium"] & temperature["high"],
            cooling_demand["high"]
        ),
        ctrl.Rule(
            occupancy["medium"] & temperature["very_high"],
            cooling_demand["maximum"]
        ),
        ctrl.Rule(
            occupancy["high"] & temperature["low"],
            cooling_demand["off"]
        ),
        ctrl.Rule(
            occupancy["high"] & temperature["moderate"],
            cooling_demand["medium"]
        ),
        ctrl.Rule(
            occupancy["high"] & temperature["high"],
            cooling_demand["high"]
        ),
        ctrl.Rule(
            occupancy["high"] & temperature["very_high"],
            cooling_demand["maximum"]
        ),
        ctrl.Rule(
            occupancy["high"] & humidity["high"] &
            temperature["moderate"],
            cooling_demand["high"]
        ),
        ctrl.Rule(
            occupancy["high"] & humidity["high"] &
            temperature["high"],
            cooling_demand["maximum"]
        ),
        ctrl.Rule(
            occupancy["low"] & temperature["very_high"],
            cooling_demand["low"]
        ),
    ]

    system = ctrl.ControlSystem(rules)
    return ctrl.ControlSystemSimulation(system)


def predict_ac_mode(temperature_c, humidity_pct, occupancy_pct):
    """Return cooling demand and a provisional recommended AC mode."""
    if not 15 <= temperature_c <= 45:
        raise ValueError("Temperature must be between 15 and 45 °C.")
    if not 0 <= humidity_pct <= 100:
        raise ValueError("Humidity must be between 0 and 100%.")
    if not 0 <= occupancy_pct <= 100:
        raise ValueError("Occupancy must be between 0 and 100%.")

    simulation = build_controller()
    simulation.input["temperature"] = temperature_c
    simulation.input["humidity"] = humidity_pct
    simulation.input["occupancy"] = occupancy_pct
    simulation.compute()

    demand = float(simulation.output["cooling_demand"])
    mode = select_ac_mode(temperature_c, humidity_pct, demand)

    return {
        "temperature_c": temperature_c,
        "humidity_pct": humidity_pct,
        "occupancy_pct": occupancy_pct,
        "cooling_demand": round(demand, 2),
        "suggested_mode": mode,
    }
