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
    assert client.get(f"/users/{missing}/assessments").status_code == 404


def test_list_assessments_newest_first(client: TestClient) -> None:
    user = client.post("/users", json={"name": "Order"}).json()
    first = client.post("/assessments", json=_base_assessment(user_id=user["id"], app_version="first"))
    assert first.status_code == 201, first.text
    time.sleep(0.05)
    second = client.post("/assessments", json=_base_assessment(user_id=user["id"], app_version="second"))
    assert second.status_code == 201, second.text
    listed = client.get(f"/users/{user['id']}/assessments")
    assert listed.status_code == 200
    versions = [row["app_version"] for row in listed.json()]
    assert versions[0] == "second"
    assert versions[1] == "first"
