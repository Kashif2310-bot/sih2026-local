import time

from fastapi.testclient import TestClient

RUN_A_OUTPUTS = {
    "project_cost": 375000,
    "loan": 337500,
    "scheme": "term",
    "interest": "8%",
}


def _base_assessment(**overrides):
    payload = {
        "location_label": "Nashik, Maharashtra",
        "lat": 20.0112,
        "lng": 73.7902,
        "business_category": "textiles",
        "margin_paise": 3_750_000,
        "project_cost_paise": 37_500_000,
        "loan_paise": 33_750_000,
        "scheme": "term",
        "lokscore": 52.0,
        "lokscore_grade": "C",
        "data_status": "incomplete",
        "inputs_json": {"margin_rupees": 37500},
        "outputs_json": RUN_A_OUTPUTS,
        "app_version": "0.0.0",
    }
    payload.update(overrides)
    return payload


def test_create_and_fetch_user(client: TestClient) -> None:
    created = client.post("/users", json={"name": "Lakshmi S.", "preferred_language": "kn"})
    assert created.status_code == 201, created.text
    body = created.json()
    fetched = client.get(f"/users/{body['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == body["id"]
    assert fetched.json()["name"] == "Lakshmi S."
    assert fetched.json()["preferred_language"] == "kn"


def test_run_a_assessment_roundtrip(client: TestClient) -> None:
    user = client.post("/users", json={"name": "Run A"}).json()
    payload = _base_assessment(user_id=user["id"])
    created = client.post("/assessments", json=payload)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["scheme"] == "term"
    assert body["project_cost_paise"] == 37_500_000
    assert body["loan_paise"] == 33_750_000
    fetched = client.get(f"/assessments/{body['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["outputs_json"] == RUN_A_OUTPUTS


def test_run_c_cap_accepted(client: TestClient) -> None:
    payload = _base_assessment(
        margin_paise=1_400_000,
        project_cost_paise=14_000_000,
        loan_paise=12_500_000,
        scheme="micro",
        outputs_json={"loan": 125000},
    )
    created = client.post("/assessments", json=payload)
    assert created.status_code == 201, created.text
    assert created.json()["scheme"] == "micro"
    assert created.json()["loan_paise"] == 12_500_000


def test_run_c_uncapped_loan_rejected(client: TestClient) -> None:
    payload = _base_assessment(
        margin_paise=1_400_000,
        project_cost_paise=14_000_000,
        loan_paise=12_600_000,
        scheme="micro",
    )
    res = client.post("/assessments", json=payload)
    assert res.status_code == 422
    assert "cap" in res.json()["detail"].lower()


def test_wrong_scheme_rejected(client: TestClient) -> None:
    payload = _base_assessment(scheme="micro")
    res = client.post("/assessments", json=payload)
    assert res.status_code == 422
    assert "scheme" in res.json()["detail"].lower()


def test_margin_zero_rejected(client: TestClient) -> None:
    payload = _base_assessment(
        margin_paise=0,
        project_cost_paise=0,
        loan_paise=0,
        scheme="micro",
    )
    res = client.post("/assessments", json=payload)
    assert res.status_code == 422
    assert "margin_paise" in res.json()["detail"]


def test_margin_above_max_rejected(client: TestClient) -> None:
    margin = 50_000_100
    payload = _base_assessment(
        margin_paise=margin,
        project_cost_paise=margin * 10,
        loan_paise=450_000_000,
        scheme="term",
    )
    res = client.post("/assessments", json=payload)
    assert res.status_code == 422
    assert "margin_paise" in res.json()["detail"]


def test_unknown_ids_404(client: TestClient) -> None:
    missing = "00000000-0000-0000-0000-000000000099"
    assert client.get(f"/users/{missing}").status_code == 404
    assert client.get(f"/assessments/{missing}").status_code == 404
    assert client.get(f"/users/{missing}/assessments").status_code == 401


def _login(client: TestClient, phone: str = "9999900000") -> dict:
    issued = client.post("/auth/request-otp", json={"phone": phone})
    assert issued.status_code == 200, issued.text
    assert issued.json()["code"] == "123456"
    verified = client.post("/auth/verify-otp", json={"phone": phone, "code": "123456"})
    assert verified.status_code == 200, verified.text
    return verified.json()


def test_request_otp_returns_demo_code(client: TestClient) -> None:
    res = client.post("/auth/request-otp", json={"phone": "9000000001"})
    assert res.status_code == 200
    body = res.json()
    assert body["phone"] == "9000000001"
    assert body["code"] == "123456"


def test_verify_otp_wrong_code_rejected(client: TestClient) -> None:
    res = client.post("/auth/verify-otp", json={"phone": "9000000002", "code": "000000"})
    assert res.status_code == 401
    assert "wrong" in res.json()["detail"].lower()


def test_verify_otp_creates_user_and_token(client: TestClient) -> None:
    session = _login(client, "9000000003")
    assert session["token"]
    assert session["user"]["phone"] == "9000000003"
    again = client.post("/auth/verify-otp", json={"phone": "9000000003", "code": "123456"})
    assert again.status_code == 200
    assert again.json()["user"]["id"] == session["user"]["id"]


def test_history_requires_token(client: TestClient) -> None:
    session = _login(client, "9000000004")
    user_id = session["user"]["id"]
    listed = client.get(f"/users/{user_id}/assessments")
    assert listed.status_code == 401
    ok = client.get(
        f"/users/{user_id}/assessments",
        headers={"Authorization": f"Bearer {session['token']}"},
    )
    assert ok.status_code == 200
    assert ok.json() == []


def test_list_assessments_newest_first(client: TestClient) -> None:
    session = _login(client, "9000000005")
    user_id = session["user"]["id"]
    headers = {"Authorization": f"Bearer {session['token']}"}
    first = client.post("/assessments", json=_base_assessment(user_id=user_id, app_version="first"))
    assert first.status_code == 201, first.text
    time.sleep(0.05)
    second = client.post("/assessments", json=_base_assessment(user_id=user_id, app_version="second"))
    assert second.status_code == 201, second.text
    listed = client.get(f"/users/{user_id}/assessments", headers=headers)
    assert listed.status_code == 200
    versions = [row["app_version"] for row in listed.json()]
    assert versions[0] == "second"
    assert versions[1] == "first"


def test_claim_guest_assessment_after_login(client: TestClient) -> None:
    created = client.post("/assessments", json=_base_assessment())
    assert created.status_code == 201, created.text
    assessment_id = created.json()["id"]
    assert created.json()["user_id"] is None
    session = _login(client, "9000000006")
    claimed = client.patch(
        f"/assessments/{assessment_id}",
        headers={"Authorization": f"Bearer {session['token']}"},
    )
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["user_id"] == session["user"]["id"]
    listed = client.get(
        f"/users/{session['user']['id']}/assessments",
        headers={"Authorization": f"Bearer {session['token']}"},
    )
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == assessment_id
