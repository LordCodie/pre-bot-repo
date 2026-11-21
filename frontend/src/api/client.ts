export type ApiErrorCode =
  | "invalid_parameter"
  | "cors_forbidden"
  | "route_not_found"
  | "match_not_found"
  | "team_not_found"
  | "prediction_not_found"
  | "rate_limited"
  | "ml_service_error"
  | "ml_invalid_response"
  | "database_error"
  | "ml_service_unavailable"
  | "internal_error"
  | "network_error"
  | string;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface RequestOptions {
  params?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

const API_BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/+$/, "");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function makeNetworkError(message = "Cannot reach the football data server.") {
  return new ApiError(0, "network_error", message);
}

export async function request<T>(
  path: string,
  { params, signal }: RequestOptions = {},
): Promise<T | ApiEnvelope<T>> {
  if (!path.startsWith("/api/")) {
    throw new ApiError(0, "network_error", "Requests must use a documented /api endpoint.");
  }

  const url = new URL(path, `${API_BASE_URL}/`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 10_000);

  try {
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (timedOut) throw makeNetworkError("The football data server took too long to respond.");
      throw makeNetworkError();
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw makeNetworkError("The football data server returned an unreadable response.");
    }

    if (!response.ok) {
      const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
      const code = typeof errorPayload?.code === "string" ? errorPayload.code : "network_error";
      const message =
        typeof errorPayload?.message === "string"
          ? errorPayload.message
          : "The football data server could not complete this request.";
      throw new ApiError(response.status, code, message);
    }

    if (path === "/api/health") return payload as T;

    if (isRecord(payload) && "data" in payload) {
      const envelope: ApiEnvelope<T> = { data: payload.data as T };
      if (isRecord(payload.meta)) {
        envelope.meta = payload.meta as ApiEnvelope<T>["meta"];
      }
      return envelope;
    }

    throw makeNetworkError("The football data server returned an unexpected response.");
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export function unwrapEnvelope<T>(response: T | ApiEnvelope<T>): T {
  if (isRecord(response) && "data" in response) return response.data as T;
  return response as T;
}

export function getEnvelopeMeta<T>(response: T | ApiEnvelope<T>): ApiEnvelope<T>["meta"] {
  if (isRecord(response) && "data" in response && isRecord(response.meta)) {
    return response.meta as ApiEnvelope<T>["meta"];
  }
  return undefined;
}