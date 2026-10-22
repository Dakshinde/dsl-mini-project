from pydantic import BaseModel, Field, validator
from typing import Optional, Dict, Any, Literal


# --- Request/Response Schemas for Phase 4 Endpoints ---

class HealthResponse(BaseModel):
    """Response model for the /health endpoint."""
    status: str
    service: str
    version: str
    message: str


# --- AC Prediction Schemas ---

class AcPredictionRequest(BaseModel):
    """Request model for AC mode prediction."""
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


class AcPredictionResponse(BaseModel):
    """Response model for AC mode prediction."""
    temperature_c: float
    humidity_pct: float
    occupancy_pct: float
    cooling_demand: float
    suggested_mode: str
    model_note: str = Field(
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
    value: Optional[str] = None
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