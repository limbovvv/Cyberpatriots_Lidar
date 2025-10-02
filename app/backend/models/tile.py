from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UUIDMixin


class Tile(UUIDMixin, Base):
    __tablename__ = "tiles"

    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), nullable=False, index=True)
    z: Mapped[int] = mapped_column(Integer, nullable=False)
    x: Mapped[int] = mapped_column(Integer, nullable=False)
    y: Mapped[int] = mapped_column(Integer, nullable=False)
    uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    base_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    dataset: Mapped["Dataset"] = relationship(back_populates="tiles")
