from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from ..core.database import get_session
from ..schemas.dataset import DatasetCreate, DatasetRead
from ..services.dataset_service import (
    create_dataset,
    create_dataset_from_upload,
    get_dataset,
    list_datasets,
)

router = APIRouter(prefix="/datasets", tags=["datasets"])


@router.get("/", response_model=list[DatasetRead])
def read_datasets(session: Session = Depends(get_session)):
    return list(list_datasets(session))


@router.post("/", response_model=DatasetRead, status_code=status.HTTP_201_CREATED)
def create_dataset_endpoint(payload: DatasetCreate, session: Session = Depends(get_session)):
    dataset = create_dataset(session, payload)
    return dataset


@router.get("/{dataset_id}", response_model=DatasetRead)
def read_dataset(dataset_id: str, session: Session = Depends(get_session)):
    dataset = get_dataset(session, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")
    return dataset


@router.post("/upload", response_model=DatasetRead, status_code=status.HTTP_201_CREATED)
def upload_dataset(
    name: str = Form(...),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    try:
        dataset = create_dataset_from_upload(session, name, file)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return dataset
