HEMS Phase 3C - Fuzzy Logic Controller

Files:
- fuzzy_controller.py: reusable fuzzy controller module

Requirements:
- numpy
- scikit-fuzzy

Example:
from fuzzy_controller import predict_ac_mode
result = predict_ac_mode(32, 70, 90)
print(result)

Note:
The fuzzy rules and AC mode thresholds are provisional prototype
settings. They have not been validated against real-world energy
savings, comfort measurements, or a physical AC unit.
