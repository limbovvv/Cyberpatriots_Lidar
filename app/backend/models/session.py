from typing import List

from sqlalchemy import Boolean, ForeignKey, Integer, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UUIDMixin


class Session(UUIDMixin, Base):
    __tablename__ = "sessions"

    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    closed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    dataset: Mapped["Dataset"] = relationship(back_populates="sessions")
    operations: Mapped[List["Operation"]] = relationship(
        back_populates="session", cascade="all,delete-orphan"
    )


class Operation(UUIDMixin, Base):
    __tablename__ = "ops"

    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    op: Mapped[dict] = mapped_column(JSON, nullable=False)

    session: Mapped[Session] = relationship(back_populates="operations")
