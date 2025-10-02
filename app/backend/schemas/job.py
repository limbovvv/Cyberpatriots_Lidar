from datetime import datetime

from pydantic import BaseModel, ConfigDict

from ..models.job import JobKind, JobStatus


class JobRead(BaseModel):
    id: str
    dataset_id: str
    kind: JobKind
    status: JobStatus
    meta: dict
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
