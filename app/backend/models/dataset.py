from enum import Enum
from typing import List

from sqlalchemy import BigInteger, Enum as SqlEnum, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UUIDMixin


class DatasetStatus(str, Enum):
    uploaded = "uploaded"
    tiled = "tiled"
    ready = "ready"


class Dataset(UUIDMixin, Base):
    __tablename__ = "datasets"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    raw_uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    status: Mapped[DatasetStatus] = mapped_column(
        SqlEnum(DatasetStatus, name="dataset_status"), default=DatasetStatus.uploaded, nullable=False
    )
    points_total: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    tiles: Mapped[List["Tile"]] = relationship(back_populates="dataset", cascade="all,delete-orphan")
    sessions: Mapped[List["Session"]] = relationship(back_populates="dataset", cascade="all,delete-orphan")
    masks: Mapped[List["Mask"]] = relationship(back_populates="dataset", cascade="all,delete-orphan")
    jobs: Mapped[List["Job"]] = relationship(back_populates="dataset", cascade="all,delete-orphan")
