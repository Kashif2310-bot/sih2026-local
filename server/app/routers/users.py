from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.deps import get_db
from app.models import Assessment, User
from app.routers.auth import require_user
from app.schemas import AssessmentOut, UserCreate, UserOut

router = APIRouter(prefix="/users", tags=["users"])


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db)) -> User:
    user = User(
        phone=payload.phone,
        name=payload.name,
        preferred_language=payload.preferred_language,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: str, db: Session = Depends(get_db)) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")
    return user


@router.get("/{user_id}/assessments", response_model=list[AssessmentOut])
def list_user_assessments(
    user_id: str,
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
) -> list[Assessment]:
    if current.id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="token does not match user")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")
    return (
        db.query(Assessment)
        .filter(Assessment.user_id == user_id)
        .order_by(Assessment.created_at.desc(), Assessment.id.desc())
        .all()
    )
