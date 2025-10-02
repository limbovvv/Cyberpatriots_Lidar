from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class OperationRead(BaseModel):
    id: str
    version: int
    op: dict[str, Any]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SessionRead(BaseModel):
    id: str
    dataset_id: str
    version: int
    closed: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SessionOpsAppend(BaseModel):
    base_version: int = Field(alias="baseVersion")
    ops: list[dict[str, Any]]

    model_config = ConfigDict(populate_by_name=True)
