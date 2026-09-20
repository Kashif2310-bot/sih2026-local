from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db import Base


def new_uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("preferred_language IN ('en', 'kn', 'hi')", name="ck_users_preferred_language"),
        CheckConstraint("role IN ('beneficiary', 'officer')", name="ck_users_role"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    phone: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    preferred_language: Mapped[str] = mapped_column(String(8), nullable=False, default="en", server_default="en")
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="beneficiary", server_default="beneficiary")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    assessments: Mapped[list[Assessment]] = relationship(back_populates="user")
    loans: Mapped[list[Loan]] = relationship(back_populates="user")


class Assessment(Base):
    __tablename__ = "assessments"
    __table_args__ = (
        CheckConstraint("scheme IN ('micro', 'term')", name="ck_assessments_scheme"),
        CheckConstraint("data_status IN ('complete', 'incomplete')", name="ck_assessments_data_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    location_label: Mapped[str] = mapped_column(String(255), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    business_category: Mapped[str] = mapped_column(String(64), nullable=False)
    margin_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    project_cost_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    loan_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    scheme: Mapped[str] = mapped_column(String(16), nullable=False)
    lokscore: Mapped[float] = mapped_column(Float, nullable=False)
    lokscore_grade: Mapped[str] = mapped_column(String(8), nullable=False)
    data_status: Mapped[str] = mapped_column(String(16), nullable=False)
    inputs_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    outputs_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    app_version: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    user: Mapped[User | None] = relationship(back_populates="assessments")
    loan: Mapped[Loan | None] = relationship(back_populates="assessment")


class Loan(Base):
    __tablename__ = "loans"
    __table_args__ = (
        CheckConstraint("scheme IN ('micro', 'term')", name="ck_loans_scheme"),
        CheckConstraint("status IN ('active', 'closed')", name="ck_loans_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    assessment_id: Mapped[str] = mapped_column(String(36), ForeignKey("assessments.id"), unique=True, nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    scheme: Mapped[str] = mapped_column(String(16), nullable=False)
    principal_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    rate_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    tenure_months: Mapped[int] = mapped_column(Integer, nullable=False)
    moratorium_months: Mapped[int] = mapped_column(Integer, nullable=False)
    attestation_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active")
    sanctioned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    assessment: Mapped[Assessment] = relationship(back_populates="loan")
    user: Mapped[User] = relationship(back_populates="loans")
    repayments: Mapped[list[Repayment]] = relationship(back_populates="loan")
    checkins: Mapped[list[Checkin]] = relationship(back_populates="loan")


class Repayment(Base):
    __tablename__ = "repayments"
    __table_args__ = (
        UniqueConstraint("loan_id", "installment_no", name="uq_repayments_loan_installment"),
        CheckConstraint("status IN ('upcoming', 'paid', 'overdue')", name="ck_repayments_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    loan_id: Mapped[str] = mapped_column(String(36), ForeignKey("loans.id"), nullable=False)
    installment_no: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="upcoming", server_default="upcoming")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")

    loan: Mapped[Loan] = relationship(back_populates="repayments")


class Checkin(Base):
    __tablename__ = "checkins"
    __table_args__ = (UniqueConstraint("loan_id", "period", name="uq_checkins_loan_period"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    loan_id: Mapped[str] = mapped_column(String(36), ForeignKey("loans.id"), nullable=False)
    period: Mapped[str] = mapped_column(String(7), nullable=False)
    revenue_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expenses_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    customers: Mapped[int] = mapped_column(Integer, nullable=False)
    lokscore_recomputed: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    loan: Mapped[Loan] = relationship(back_populates="checkins")
