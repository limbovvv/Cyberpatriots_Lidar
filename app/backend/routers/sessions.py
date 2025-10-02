from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..core.database import get_session
from ..schemas.session import OperationRead, SessionOpsAppend, SessionRead
from ..services.session_service import (
    append_operations,
    create_session,
    get_session_by_id,
    list_sessions,
)

router = APIRouter(prefix="/datasets/{dataset_id}/sessions", tags=["sessions"])


@router.get("/", response_model=list[SessionRead])
def read_sessions(dataset_id: str, session: Session = Depends(get_session)):
    return list(list_sessions(session, dataset_id))


@router.post("/", response_model=SessionRead, status_code=status.HTTP_201_CREATED)
def create_session_endpoint(dataset_id: str, session: Session = Depends(get_session)):
    dataset_session = create_session(session, dataset_id)
    return dataset_session


@router.get("/{session_id}", response_model=SessionRead)
def read_session(dataset_id: str, session_id: str, session: Session = Depends(get_session)):
    dataset_session = get_session_by_id(session, dataset_id, session_id)
    if dataset_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return dataset_session


@router.patch("/{session_id}/ops", response_model=list[OperationRead])
def append_ops(
    dataset_id: str,
    session_id: str,
    payload: SessionOpsAppend,
    session: Session = Depends(get_session),
):
    dataset_session = get_session_by_id(session, dataset_id, session_id)
    if dataset_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if payload.base_version != dataset_session.version:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Version mismatch")
    stored_ops = append_operations(session, dataset_session, payload.ops)
    return stored_ops
