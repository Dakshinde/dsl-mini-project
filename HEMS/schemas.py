from pydantic import BaseModel, Field, validator
from typing import Optional, Dict, Any, Literal, Union


# --- Request/Response Schemas for Phase 4 Endpoints ---

class HealthResponse(BaseModel):
    """Response model for the /health endpoint."""
    status: str
    service: str
    version: str
    message: str


# --- AC Prediction Schemas (using Random Forest model inputs) ---

# The pretrained Random Forest model expects these 6 features in this order:
# ['ambient_temp', 'relative_humidity', 'motion_sensor', 'grid_power', 'hour', 'day_of_week']
# This is different from the fuzzy controller inputs (temp/humidity/occupancy).
# See PRD Step 4.2: inspect model.feature_names_in_ before implementing.

AC_MODE_LABELS = {
    0: "Eco",
    1: "Max Cool",
    2: "Dry",
}
# Note: Model has 3 classes [0,1,2] while PRD originally documented 4 classes
# (Off, Eco, Dry, Max Cool). The model does not predict "Off" — it predicts
# among Eco, Max Cool, Dry based on environmental conditions.
# This mapping is derived from the training dataset analysis (see PRD limitation).

class AcPredictionRequest(BaseModel):
    """Request model for AC mode prediction using Random Forest model.

    Inputs map to the pretrained Random Forest model's feature order:
    - ambient_temp: Ambient temperature in Celsius (15-45)
    - relative_humidity: Relative humidity in percentage (0-100)
    - motion_sensor: Binary motion sensor value (0 or 1)
    - grid_power: Grid power consumption (typically 0 or 1, normalized)
    - hour: Hour of day (0-23)
    - day_of_week: Day of week (0=Monday ... 6=Sunday)

    Important: These are the exact feature names and order that the model was
    trained with. Do not reorder or rename without retraining.
    """

    ambient_temp: float = Field(
        ..., ge=15, le=45,
        description="Ambient temperature in Celsius (15-45 °C)"
    )
    relative_humidity: float = Field(
        ..., ge=0, le=100,
        description="Relative humidity in percentage (0-100 %)"
    )
    motion_sensor: int = Field(
        ..., ge=0, le=1,
        description="Binary motion sensor value (0 = no motion, 1 = motion)"
    )
    grid_power: float = Field(
        ..., ge=0, le=1,
        description="Grid power consumption (0 = idle, 1 = active)"
    )
    hour: int = Field(
        ..., ge=0, le=23,
        description="Hour of day (0-23, 24-hour format)"
    )
    day_of_week: int = Field(
        ..., ge=0, le=6,
        description="Day of week (0=Monday, 1=Tuesday, ..., 6=Sunday)"
    )

    @validator('motion_sensor')
    def motion_binary(cls, v):
        if v not in (0, 1):
            raise ValueError('Motion sensor must be 0 or 1')
        return v

    @validator('grid_power')
    def grid_power_range(cls, v):
        if not (0 <= v <= 1):
            raise ValueError('Grid power must be between 0 and 1')
        return v

    @validator('hour')
    def hour_range(cls, v):
        if not (0 <= v <= 23):
            raise ValueError('Hour must be between 0 and 23')
        return v

    @validator('day_of_week')
    def dow_range(cls, v):
        if not (0 <= v <= 6):
            raise ValueError('Day of week must be 0-6 (Mon-Sun)')
        return v


class AcPredictionResponse(BaseModel):
    """Response model for AC mode prediction using Random Forest model."""
    ambient_temp: float
    relative_humidity: float
    motion_sensor: int
    grid_power: float
    hour: int
    day_of_week: int

    predicted_mode: str
    predicted_mode_code: int
    probability: Optional[float] = None
    model_input_feature_order: list[str] = Field(
        default=['ambient_temp', 'relative_humidity', 'motion_sensor', 'grid_power', 'hour', 'day_of_week'],
        description="Expected feature order for the Random Forest model"
    )
    model_limitations: str = Field(
        default=(
            "Model predicts among 3 modes: Eco, Max Cool, Dry. "
            "Does not predict 'Off' mode. "
            "Class mapping derived from dataset analysis: "
            "Class 0 (Eco) ~ moderate temp ~25°C, "
            "Class 1 (Max Cool) ~ hot temp ~35°C, "
            "Class 2 (Dry) ~ hot+humid temp ~32°C, high humidity ~85%. "
            "See PRD for full integration limitations."
        ),
        description="Note about model provenance and limitations"
    )


# --- Occupancy Estimation Schemas ---

class OccupancyEstimateRequest(BaseModel):
    """Request model for occupancy estimation."""
    timestamp: str = Field(
        ..., description="ISO format timestamp or time period identifier"
    )
    motion_detected: bool = Field(
        ..., description="Binary motion sensor value"
    )

    @validator('timestamp')
    def valid_timestamp(cls, v):
        if not v.strip():
            raise ValueError('Timestamp must not be empty')
        return v


class OccupancyEstimateResponse(BaseModel):
    """Response model for occupancy estimation."""
    time_period: str
    motion_detected: bool
    occupancy_probability: float
    occupancy_percentage: float
    likely_occupied: bool
    provisional_note: str = Field(
        description="Note about provisional nature of estimates"
    )


# --- NLP Command Parsing Schemas ---

class NlpParseRequest(BaseModel):
    """Request model for NLP command parsing."""
    command: str = Field(
        ..., description="Natural language command string"
    )

    @validator('command')
    def valid_command(cls, v):
        if not v.strip():
            raise ValueError('Command must not be empty')
        return v.strip()


class NlpParseResponse(BaseModel):
    """Response model for NLP command parsing."""
    command: str
    intent: str
    appliance: Optional[str] = None
    action: Optional[str] = None
    value: Optional[Union[str, Dict[str, Any]]] = None  # Accepts mode string, dict, or None
    confidence: float
    needs_clarification: bool
    message: str


# --- Fuzzy Control Schemas ---

class FuzzyControlRequest(BaseModel):
    """Request model for fuzzy logic control."""
    temperature_c: float = Field(
        ..., ge=15, le=45,
        description="Ambient temperature in Celsius (15-45)"
    )
    humidity_pct: float = Field(
        ..., ge=0, le=100,
        description="Relative humidity in percentage (0-100)"
    )
    occupancy_pct: float = Field(
        ..., ge=0, le=100,
        description="Occupancy probability in percentage (0-100)"
    )

    @validator('temperature_c')
    def temp_range(cls, v):
        if not (15 <= v <= 45):
            raise ValueError('Temperature must be between 15 and 45 °C')
        return v

    @validator('humidity_pct')
    def humidity_range(cls, v):
        if not (0 <= v <= 100):
            raise ValueError('Humidity must be between 0 and 100%')
        return v

    @validator('occupancy_pct')
    def occupancy_range(cls, v):
        if not (0 <= v <= 100):
            raise ValueError('Occupancy must be between 0 and 100%')
        return v


class FuzzyControlResponse(BaseModel):
    """Response model for fuzzy control."""
    temperature_c: float
    humidity_pct: float
    occupancy_pct: float
    cooling_demand: float
    suggested_mode: str
    model_note: str = Field(
        description="Note about model provenance and limitations"
    )


# --- Unified Recommendation Schemas ---

class RecommendationRequest(BaseModel):
    """Request model for unified recommendation."""
    temperature_c: float = Field(
        ..., ge=15, le=45,
        description="Ambient temperature in Celsius (15-45)"
    )
    humidity_pct: float = Field(
        ..., ge=0, le=100,
        description="Relative humidity in percentage (0-100)"
    )
    occupancy_pct: float = Field(
        ..., ge=0, le=100,
        description="Occupancy probability in percentage (0-100)"
    )
    command: Optional[str] = Field(
        None, description="Optional natural language command"
    )

    @validator('temperature_c')
    def temp_range(cls, v):
        if not (15 <= v <= 45):
            raise ValueError('Temperature must be between 15 and 45 °C')
        return v

    @validator('humidity_pct')
    def humidity_range(cls, v):
        if not (0 <= v <= 100):
            raise ValueError('Humidity must be between 0 and 100%')
        return v

    @validator('occupancy_pct')
    def occupancy_range(cls, v):
        if not (0 <= v <= 100):
            raise ValueError('Occupancy must be between 0 and 100%')
        return v


class ComponentOutput(BaseModel):
    """Model for a single component's output in a unified recommendation."""
    component: str
    function: str
    input_summary: Dict[str, Any]
    output: Dict[str, Any]


class RecommendationResponse(BaseModel):
    """Response model for unified recommendation."""
    component_outputs: list[ComponentOutput]
    overall_recommendation: Dict[str, Any]
    disclaimer: str


# --- MongoDB Persistence Schemas (optional, for future use) ---

# class MongoDbLog(BaseModel):
#     """Optional MongoDB document schema for logging."""
#     timestamp: str
#     endpoint: str
#     request: Dict[str, Any]
#     response: Dict[str, Any]
#     session_id: Optional[str] = None