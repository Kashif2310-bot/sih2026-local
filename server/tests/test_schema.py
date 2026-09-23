from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Assessment, Loan, Repayment, User


def _user(**kwargs) -> User:
    fields = {"name": "Lakshmi S.", "phone": "+919876543210"}
    fields.update(kwargs)
    return User(**fields)


def _assessment(user_id: str | None = None) -> Assessment:
    return Assessment(
        user_id=user_id,
        location_label="Nashik, Maharashtra",
        lat=20.0112,
        lng=73.7902,
        business_category="textiles",
        margin_paise=3_750_000,
        project_cost_paise=37_500_000,
        loan_paise=33_750_000,
        scheme="term",
        lokscore=52.0,
        lokscore_grade="C",
        data_status="incomplete",
        inputs_json={"margin": 37500},
        outputs_json={"scheme": "term"},
        app_version="0.0.0",
    )


def _loan(assessment_id: str, user_id: str) -> Loan:
    return Loan(
        assessment_id=assessment_id,
        user_id=user_id,
        scheme="term",
        principal_paise=33_750_000,
        rate_bps=800,
        tenure_months=84,
        moratorium_months=6,
        attestation_hash="0xabc",
    )


def test_create_user_and_assessment(session: Session) -> None:
    user = _user()
    session.add(user)
    session.flush()
    assessment = _assessment(user_id=user.id)
    session.add(assessment)
    session.commit()
    session.refresh(user)
    session.refresh(assessment)
    assert user.id
    assert assessment.id
    assert assessment.user_id == user.id
    assert assessment.margin_paise == 3_750_000
    assert assessment.scheme == "term"


def test_guest_assessment_allowed(session: Session) -> None:
    assessment = _assessment(user_id=None)
    session.add(assessment)
    session.commit()
    assert assessment.user_id is None


def test_repayment_without_loan_fails(session: Session) -> None:
    session.add(
        Repayment(
            loan_id="00000000-0000-0000-0000-000000000001",
            installment_no=1,
            due_date=date(2027, 3, 1),
            amount_paise=1_745_100,
        )
    )
    with pytest.raises(IntegrityError):
        session.commit()


def test_duplicate_loan_installment_fails(session: Session) -> None:
    user = _user(phone="+911111111111")
    session.add(user)
    session.flush()
    assessment = _assessment(user_id=user.id)
    session.add(assessment)
    session.flush()
    loan = _loan(assessment.id, user.id)
    session.add(loan)
    session.flush()
    session.add(
        Repayment(
            loan_id=loan.id,
            installment_no=1,
            due_date=date(2027, 3, 1),
            amount_paise=1_745_100,
        )
    )
    session.add(
        Repayment(
            loan_id=loan.id,
            installment_no=1,
            due_date=date(2027, 6, 1),
            amount_paise=1_745_100,
        )
    )
    with pytest.raises(IntegrityError):
        session.commit()
