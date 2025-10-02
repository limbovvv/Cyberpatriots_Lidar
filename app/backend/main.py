from starlette import formparsers

from fastapi import FastAPI

from .core.config import get_settings
from .core.database import get_engine
from .models import Base
from .routers import datasets, export, sessions, tiles, ml

formparsers.MultiPartParser.max_file_size = 1024 * 1024 * 1024 * 10 # 1 GiB limit per file

app = FastAPI(title=get_settings().app_name)


@app.on_event("startup")
def startup_event() -> None:
    Base.metadata.create_all(bind=get_engine())


app.include_router(datasets.router)
app.include_router(tiles.router)
app.include_router(sessions.router)
app.include_router(export.router)
app.include_router(ml.router)
