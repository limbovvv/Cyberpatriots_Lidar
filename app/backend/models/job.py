from enum import Enum

from sqlalchemy import Enum as SqlEnum, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UUIDMixin


class JobKind(str, Enum):
    tiling = "tiling"
    apply = "apply"
    export = "export"


class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    done = "done"
    error = "error"


class Job(UUIDMixin, Base):
    __tablename__ = "jobs"

    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), nullable=False, index=True)
    kind: Mapped[JobKind] = mapped_column(SqlEnum(JobKind, name="job_kind"), nullable=False)
    status: Mapped[JobStatus] = mapped_column(
        SqlEnum(JobStatus, name="job_status"), default=JobStatus.pending, nullable=False
    )
    meta: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    dataset: Mapped["Dataset"] = relationship(back_populates="jobs")
