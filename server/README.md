# LokPulse backend

Minimal FastAPI service. SQLite by default; set `DATABASE_URL` to switch to Postgres later.

## Windows PowerShell setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check: http://127.0.0.1:8000/health
