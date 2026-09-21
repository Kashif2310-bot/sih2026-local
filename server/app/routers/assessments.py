from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.deps import get_db
from app.models import Assessment, User
from app.routers.auth import require_user
from app.rules import validate_nsfdc_snapshot
from app.schemas import AssessmentCreate, AssessmentOut

router = APIRouter(prefix="/assessments", tags=["assessments"])


@router.post("", response_model=AssessmentOut, status_code=status.HTTP_201_CREATED)
def create_assessment(payload: AssessmentCreate, db: Session = Depends(get_db)) -> Assessment:
    try:
        validate_nsfdc_snapshot(
            margin_paise=payload.margin_paise,
            project_cost_paise=payload.project_cost_paise,
            loan_paise=payload.loan_paise,
            scheme=payload.scheme,
            data_status=payload.data_status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    if payload.user_id is not None and db.get(User, payload.user_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")

    row = Assessment(
        user_id=payload.user_id,
        location_label=payload.location_label,
        lat=payload.lat,
        lng=payload.lng,
        business_category=payload.business_category,
        margin_paise=payload.margin_paise,
        project_cost_paise=payload.project_cost_paise,
        loan_paise=payload.loan_paise,
        scheme=payload.scheme,
        lokscore=payload.lokscore,
        lokscore_grade=payload.lokscore_grade,
        data_status=payload.data_status,
        inputs_json=payload.inputs_json,
        outputs_json=payload.outputs_json,
        app_version=payload.app_version,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{assessment_id}", response_model=AssessmentOut)
def get_assessment(assessment_id: str, db: Session = Depends(get_db)) -> Assessment:
    row = db.get(Assessment, assessment_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="assessment not found")
    return row


@router.patch("/{assessment_id}", response_model=AssessmentOut)
def claim_assessment(
    assessment_id: str,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> Assessment:
    row = db.get(Assessment, assessment_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="assessment not found")
    if row.user_id is not None and row.user_id != current.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="assessment belongs to another user")
    row.user_id = current.id
    db.commit()
    db.refresh(row)
    return row
