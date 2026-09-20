from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Language = Literal["en", "kn", "hi"]
Scheme = str
DataStatus = str


class UserCreate(BaseModel):
    phone: str | None = None
    name: str | None = None
    preferred_language: Language = "en"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    phone: str | None
    name: str | None
    preferred_language: str
    role: str
    created_at: datetime


class AssessmentCreate(BaseModel):
    user_id: str | None = None
    location_label: str
    lat: float
    lng: float
    business_category: str
    margin_paise: int
    project_cost_paise: int
    loan_paise: int
    scheme: str
    lokscore: float
    lokscore_grade: str
    data_status: str
    inputs_json: dict[str, Any] = Field(default_factory=dict)
    outputs_json: dict[str, Any] = Field(default_factory=dict)
    app_version: str


class AssessmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str | None
    location_label: str
    lat: float
    lng: float
    business_category: str
    margin_paise: int
    project_cost_paise: int
    loan_paise: int
    scheme: str
    lokscore: float
    lokscore_grade: str
    data_status: str
    inputs_json: dict[str, Any]
    outputs_json: dict[str, Any]
    app_version: str
    created_at: datetime
