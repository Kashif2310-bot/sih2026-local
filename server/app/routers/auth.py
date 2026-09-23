from __future__ import annotations

import logging
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.deps import get_db
from app.models import AuthToken, User
from app.schemas import AuthSession, OtpIssued, PhoneBody, UserOut, VerifyOtpBody

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger("lokpulse.auth")

DEMO_OTP = "123456"


def require_user(
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token required")
    token = authorization.split(" ", 1)[1].strip()
    row = db.get(AuthToken, token)
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")
    user = db.get(User, row.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")
    return user


@router.post("/request-otp", response_model=OtpIssued)
def request_otp(payload: PhoneBody) -> OtpIssued:
    phone = payload.phone.strip()
    if not phone:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="phone required")
    log.info("demo OTP for %s: %s", phone, DEMO_OTP)
    print(f"demo OTP for {phone}: {DEMO_OTP}", flush=True)
    return OtpIssued(phone=phone, code=DEMO_OTP)


@router.post("/verify-otp", response_model=AuthSession)
def verify_otp(payload: VerifyOtpBody, db: Session = Depends(get_db)) -> AuthSession:
    phone = payload.phone.strip()
    if payload.code != DEMO_OTP:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="wrong code")
    user = db.query(User).filter(User.phone == phone).one_or_none()
    if user is None:
        user = User(phone=phone, name=phone)
        db.add(user)
        db.flush()
    token = secrets.token_hex(16)
    db.add(AuthToken(token=token, user_id=user.id))
    db.commit()
    db.refresh(user)
    return AuthSession(user=UserOut.model_validate(user), token=token)
