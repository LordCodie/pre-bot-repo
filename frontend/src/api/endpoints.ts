import { request, type ApiEnvelope } from "@/api/client";
import type {
  AccuracyData,
  HealthStatus,
  League,
  MatchDetail,
  PredictionResult,
  RecentMatch,
  RecentMatchParams,
  ScraperStatus,
  TeamStats,
  UpcomingMatch,
  UpcomingMatchParams,
} from "@/api/types";

export function getUpcomingMatches(
  params: UpcomingMatchParams,
  signal?: AbortSignal,
): Promise<ApiEnvelope<UpcomingMatch[]>> {
  return request<UpcomingMatch[]>("/api/matches/upcoming", { params, signal }) as Promise<
    ApiEnvelope<UpcomingMatch[]>
  >;
}

export function getRecentMatches(
  params: RecentMatchParams,
  signal?: AbortSignal,
): Promise<ApiEnvelope<RecentMatch[]>> {
  return request<RecentMatch[]>("/api/matches/recent", { params, signal }) as Promise<
    ApiEnvelope<RecentMatch[]>
  >;
}

export function getMatch(id: number, signal?: AbortSignal): Promise<MatchDetail> {
  return request<MatchDetail>(`/api/matches/${id}`, { signal }).then((response) =>
    unwrapData(response),
  );
}

export function getLeagues(signal?: AbortSignal): Promise<League[]> {
  return request<League[]>("/api/leagues", { signal }).then(unwrapData);
}

export function getTeamStats(id: number, signal?: AbortSignal): Promise<TeamStats> {
  return request<TeamStats>(`/api/teams/${id}/stats`, { signal }).then(unwrapData);
}

export function getPrediction(
  matchId: number,
  live: boolean,
  signal?: AbortSignal,
): Promise<PredictionResult> {
  return request<PredictionResult>(`/api/predictions/${matchId}`, {
    params: live ? { live: true } : undefined,
    signal,
  }).then(unwrapData);
}

export function getAccuracy(signal?: AbortSignal): Promise<AccuracyData> {
  return request<AccuracyData>("/api/accuracy", { signal }).then(unwrapData);
}

export function getScraperStatus(signal?: AbortSignal): Promise<ScraperStatus> {
  return request<ScraperStatus>("/api/status/scraper", { signal }).then(unwrapData);
}

export function getHealth(deep: boolean, signal?: AbortSignal): Promise<HealthStatus> {
  return request<HealthStatus>("/api/health", {
    params: deep ? { deep: true } : undefined,
    signal,
  }) as Promise<HealthStatus>;
}

function unwrapData<T>(response: T | ApiEnvelope<T>): T {
  if (typeof response === "object" && response !== null && "data" in response) {
    return response.data;
  }
  return response as T;
}