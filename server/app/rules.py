"""NSFDC ladder checks. Rupee constants live here; all comparisons are integer paise."""

RUPEE_PAISE = 100

MAX_MARGIN_RUPEES = 5_00_000
MICRO_PROJECT_CAP_RUPEES = 1_40_000
MICRO_LOAN_CAP_RUPEES = 1_25_000
TERM_LOAN_CAP_RUPEES = 45_00_000

MAX_MARGIN_PAISE = MAX_MARGIN_RUPEES * RUPEE_PAISE
MICRO_PROJECT_CAP_PAISE = MICRO_PROJECT_CAP_RUPEES * RUPEE_PAISE
MICRO_LOAN_CAP_PAISE = MICRO_LOAN_CAP_RUPEES * RUPEE_PAISE
TERM_LOAN_CAP_PAISE = TERM_LOAN_CAP_RUPEES * RUPEE_PAISE


def expected_scheme(project_cost_paise: int) -> str:
    return "micro" if project_cost_paise <= MICRO_PROJECT_CAP_PAISE else "term"


def expected_loan_paise(project_cost_paise: int, scheme: str) -> int:
    cap = MICRO_LOAN_CAP_PAISE if scheme == "micro" else TERM_LOAN_CAP_PAISE
    return min(project_cost_paise * 9 // 10, cap)


def validate_nsfdc_snapshot(
    *,
    margin_paise: int,
    project_cost_paise: int,
    loan_paise: int,
    scheme: str,
    data_status: str,
) -> None:
    if data_status not in ("complete", "incomplete"):
        raise ValueError("data_status rule failed: must be 'complete' or 'incomplete'")
    if not isinstance(margin_paise, int) or margin_paise <= 0:
        raise ValueError("margin_paise rule failed: must be > 0")
    if margin_paise > MAX_MARGIN_PAISE:
        raise ValueError(
            f"margin_paise rule failed: exceeds max margin of {MAX_MARGIN_RUPEES} rupees "
            f"({MAX_MARGIN_PAISE} paise)"
        )
    if project_cost_paise != margin_paise * 10:
        raise ValueError(
            f"project_cost_paise rule failed: must equal margin_paise * 10 "
            f"(got {project_cost_paise}, expected {margin_paise * 10})"
        )
    want_scheme = expected_scheme(project_cost_paise)
    if scheme != want_scheme:
        raise ValueError(
            f"scheme rule failed: expected '{want_scheme}' for project_cost_paise "
            f"{project_cost_paise} (micro if <= {MICRO_PROJECT_CAP_RUPEES} rupees)"
        )
    want_loan = expected_loan_paise(project_cost_paise, scheme)
    if loan_paise != want_loan:
        cap_rupees = MICRO_LOAN_CAP_RUPEES if scheme == "micro" else TERM_LOAN_CAP_RUPEES
        raise ValueError(
            f"loan_paise cap rule failed: expected {want_loan} paise "
            f"(min of project_cost_paise * 9 // 10 and the {scheme} cap of {cap_rupees} rupees); "
            f"got {loan_paise}"
        )
