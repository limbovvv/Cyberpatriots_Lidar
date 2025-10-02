from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings

settings = get_settings()

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

_engine = create_engine(settings.database_url, future=True, connect_args=connect_args)
_SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False, future=True)


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Generator[Session, None, None]:
    with session_scope() as session:
        yield session


def get_engine() -> Engine:
    return _engine
