from pydantic import BaseModel, ConfigDict


class TileBase(BaseModel):
    z: int
    x: int
    y: int


class TileRead(TileBase):
    id: str
    uri: str
    points: int
    base_index: int

    model_config = ConfigDict(from_attributes=True)
