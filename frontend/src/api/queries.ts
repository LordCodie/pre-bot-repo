import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import {
  getAccuracy,
  getLeagues,
  getMatch,
  getRecentMatches,
  getScraperStatus,
  getTeamStats,
  getUpcomingMatches,
} from "@/api/endpoints";
import type { RecentMatchParams, UpcomingMatchParams } from "@/api/types";
import { ApiError } from "@/api/client";

export function shouldRetryApiRequest(failureCount: number, error: unknown) {
  if (failureCount >= 1) return false;
  if (!(error instanceof ApiError)) return false;
  if (error.status === 429 || error.status === 0) return error.code === "network_error";
  return error.status >= 500;
}

export const leaguesQueryOptions = () =>
  queryOptions({
    queryKey: ["leagues"],
    queryFn: ({ signal }) => getLeagues(signal),
    staleTime: 5 * 60_000,
    retry: shouldRetryApiRequest,
  });

export const upcomingMatchesQueryOptions = (params: UpcomingMatchParams) =>
  queryOptions({
    queryKey: ["matches", "upcoming", params],
    queryFn: ({ signal }) => getUpcomingMatches(params, signal),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: shouldRetryApiRequest,
  });

export const recentMatchesQueryOptions = (params: RecentMatchParams) =>
  queryOptions({
    queryKey: ["matches", "recent", params],
    queryFn: ({ signal }) => getRecentMatches(params, signal),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: shouldRetryApiRequest,
  });

export const matchQueryOptions = (id: number) =>
  queryOptions({
    queryKey: ["matches", id],
    queryFn: ({ signal }) => getMatch(id, signal),
    staleTime: 60_000,
    retry: shouldRetryApiRequest,
  });

export const teamQueryOptions = (id: number) =>
  queryOptions({
    queryKey: ["teams", id, "stats"],
    queryFn: ({ signal }) => getTeamStats(id, signal),
    staleTime: 5 * 60_000,
    retry: shouldRetryApiRequest,
  });

export const accuracyQueryOptions = () =>
  queryOptions({
    queryKey: ["accuracy"],
    queryFn: ({ signal }) => getAccuracy(signal),
    staleTime: 5 * 60_000,
    retry: shouldRetryApiRequest,
  });

export const scraperStatusQueryOptions = () =>
  queryOptions({
    queryKey: ["scraper-status"],
    queryFn: ({ signal }) => getScraperStatus(signal),
    staleTime: 30_000,
    retry: shouldRetryApiRequest,
  });