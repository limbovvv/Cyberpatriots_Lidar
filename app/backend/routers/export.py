from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..core.database import get_session
from ..schemas.job import JobRead
from ..services.job_service import perform_export
from ..storage import get_storage

router = APIRouter(prefix="/datasets/{dataset_id}/export", tags=["export"])


@router.post("/", response_model=JobRead, status_code=status.HTTP_201_CREATED)
def request_export(dataset_id: str, session: Session = Depends(get_session)):
    try:
        job, _ = perform_export(session, dataset_id)
        return job
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/")
def download_export(dataset_id: str):
    storage = get_storage()
    export_path = storage.export_dir(dataset_id) / "processed_points.pcd"
    if not export_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export not found")
    return FileResponse(export_path, media_type="text/plain", filename="processed_points.pcd")
