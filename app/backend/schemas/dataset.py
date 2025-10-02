from datetime import datetime

from pydantic import BaseModel, ConfigDict

from ..models.dataset import DatasetStatus


class DatasetBase(BaseModel):
    name: str
    raw_uri: str


class DatasetCreate(DatasetBase):
    points_total: int | None = None


class DatasetRead(DatasetBase):
    id: str
    status: DatasetStatus
    points_total: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
