from sqlalchemy import BigInteger, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UUIDMixin


class Mask(UUIDMixin, Base):
    __tablename__ = "masks"

    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    uri: Mapped[str] = mapped_column(String(1024), nullable=False)
    points_removed: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    dataset: Mapped["Dataset"] = relationship(back_populates="masks")
