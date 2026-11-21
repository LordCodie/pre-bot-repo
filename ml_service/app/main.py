"""FastAPI inference service.  uvicorn app.main:app --port 8000"""
import hmac
import os
import threading
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

load_dotenv(os.getenv("ENV_FILE", ".env"))

from app.predictor import MatchNotFound, ModelNotLoaded, Predictor  # noqa: E402
from app.schemas import (BatchPredictRequest, BatchPredictResponse, HealthResponse,  # noqa: E402
                         PredictionResult, PredictRequest)

MODEL_PATH = os.getenv("MODEL_PATH", "artifacts/model.joblib")
predictor = Predictor()
retrain = {"state": "idle", "error": None}
_lock = threading.Lock()


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        predictor.load(MODEL_PATH)
    except Exception as e:          # service still starts; /health reports model_loaded=false
        print(f"[startup] model not loaded from {MODEL_PATH}: {e}")
    yield


app = FastAPI(title="Football ML Service", lifespan=lifespan)


def _err(status, code, message, details=None):
    body = {"error": {"code": code, "message": message}}
    if details:
        body["error"]["details"] = details
    return JSONResponse(status_code=status, content=body)


@app.exception_handler(ApiError)
async def _api_error(_: Request, e: ApiError):
    return _err(e.status, e.code, e.message)


@app.exception_handler(RequestValidationError)
async def _validation(_: Request, e: RequestValidationError):
    return _err(422, "validation_error", "Invalid request",
                [{"loc": list(x["loc"]), "msg": x["msg"]} for x in e.errors()])


@app.exception_handler(Exception)
async def _unhandled(_: Request, e: Exception):
    print(f"[error] {type(e).__name__}: {e}")
    return _err(500, "internal_error", "Internal server error")


def _guard(fn, *a):
    try:
        return fn(*a)
    except ModelNotLoaded as e:
        raise ApiError(503, "model_unavailable", str(e))
    except MatchNotFound as e:
        raise ApiError(404, "match_not_found", str(e))
    except ApiError:
        raise
    except Exception as e:
        print(f"[db/inference error] {e}")
        raise ApiError(503, "upstream_unavailable", "Could not read data or run inference")


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(status="ok", model_loaded=predictor.loaded,
                          model_version=predictor.version, retrain_state=retrain["state"])


@app.post("/predict", response_model=PredictionResult)
def predict(req: PredictRequest):
    if req.match_id is not None:
        return _guard(predictor.predict_match, req.match_id)
    return _guard(predictor.predict_features, req.features)


@app.post("/predict/batch", response_model=BatchPredictResponse)
def predict_batch(req: BatchPredictRequest):
    results, missing = _guard(predictor.predict_matches, req.match_ids)
    return {"predictions": results, "missing_match_ids": missing}


def _run_retrain():
    from training.train import run
    try:
        run(skip_predict=False)
        predictor.load(MODEL_PATH)
        retrain.update(state="idle", error=None)
    except Exception as e:
        retrain.update(state="failed", error=str(e)[:300])
    finally:
        _lock.release()


@app.post("/retrain", status_code=202)
def post_retrain(tasks: BackgroundTasks, x_admin_key: str | None = Header(None)):
    expected = os.getenv("ML_ADMIN_KEY", "")
    if not expected or not x_admin_key or not hmac.compare_digest(x_admin_key, expected):
        raise ApiError(401, "unauthorized", "Invalid or missing admin key")
    if not _lock.acquire(blocking=False):
        raise ApiError(409, "retrain_in_progress", "A retrain is already running")
    retrain["state"] = "running"
    tasks.add_task(_run_retrain)
    return {"status": "accepted"}
