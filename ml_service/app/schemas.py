from typing import Optional
from pydantic import BaseModel, Field, model_validator
from training.dataset import FEATURE_COLS


class PredictRequest(BaseModel):
    match_id: Optional[int] = Field(None, ge=1)
    features: Optional[dict[str, Optional[float]]] = None

    @model_validator(mode="after")
    def _one_of(self):
        if (self.match_id is None) == (self.features is None):
            raise ValueError("Provide exactly one of 'match_id' or 'features'")
        if self.features is not None:
            unknown = set(self.features) - set(FEATURE_COLS)
            if unknown:
                raise ValueError(f"Unknown feature(s): {sorted(unknown)}")
        return self


class BatchPredictRequest(BaseModel):
    match_ids: Optional[list[int]] = Field(None, max_length=500)   # None -> all scheduled matches


class PredictionResult(BaseModel):
    match_id: Optional[int] = None
    home_win_prob: float = Field(ge=0, le=1)
    draw_prob: float = Field(ge=0, le=1)
    away_win_prob: float = Field(ge=0, le=1)
    predicted_outcome: str = Field(pattern="^[HDA]$")
    model_version: str


class BatchPredictResponse(BaseModel):
    predictions: list[PredictionResult]
    missing_match_ids: list[int] = []


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    model_version: Optional[str] = None
    retrain_state: str = "idle"
