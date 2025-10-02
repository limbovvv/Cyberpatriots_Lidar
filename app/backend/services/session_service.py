from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.session import Operation, Session as SessionModel


def list_sessions(session: Session, dataset_id: str):
    stmt = select(SessionModel).where(SessionModel.dataset_id == dataset_id).order_by(SessionModel.created_at.desc())
    return session.scalars(stmt)


def create_session(session: Session, dataset_id: str) -> SessionModel:
    dataset_session = SessionModel(dataset_id=dataset_id)
    session.add(dataset_session)
    session.flush()
    return dataset_session


def get_session_by_id(session: Session, dataset_id: str, session_id: str) -> SessionModel | None:
    dataset_session = session.get(SessionModel, session_id)
    if dataset_session is None or dataset_session.dataset_id != dataset_id:
        return None
    return dataset_session


def append_operations(session: Session, dataset_session: SessionModel, operations: list[dict]) -> list[Operation]:
    new_version = dataset_session.version
    stored_ops: list[Operation] = []
    for entry in operations:
        new_version += 1
        op = Operation(session_id=dataset_session.id, version=new_version, op=entry)
        session.add(op)
        stored_ops.append(op)
    dataset_session.version = new_version
    session.flush()
    return stored_ops
