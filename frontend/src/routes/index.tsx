import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { UpcomingMatchParams } from "@/api/types";
import { upcomingMatchesQueryOptions } from "@/api/queries";
import {
  FixtureCard,
  LeagueFilter,
  PageHeading,
  PaginationControls,
} from "@/components/football-data-components";
import { EmptyState, QueryBoundary } from "@/components/football-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface FixtureSearch {
  league: number | undefined;
  date: string | undefined;
  window: number;
  search: string | undefined;
  page: number;
}

function parseFixtureSearch(search: Record<string, unknown>): FixtureSearch {
  const rawLeague = Number(search.league);
  const rawWindow = Number(search.window);
  const rawPage = Number(search.page);
  const dateValue = typeof search.date === "string" ? search.date : "";
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dateValue) &&
    new Date(`${dateValue}T00:00:00.000Z`).toISOString().slice(0, 10) === dateValue;
  const searchValue = typeof search.search === "string" ? search.search.trim().slice(0, 50) : "";

  return {
    league: Number.isSafeInteger(rawLeague) && rawLeague > 0 ? rawLeague : undefined,
    date: validDate ? dateValue : undefined,
    window: Number.isInteger(rawWindow) && rawWindow >= 1 && rawWindow <= 60 ? rawWindow : 14,
    search: searchValue || undefined,
    page: Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1,
  };
}

export const Route = createFileRoute("/")({
  validateSearch: parseFixtureSearch,
  head: () => ({
    meta: [
      { title: "Upcoming Fixtures & Predictions | Touchline" },
      {
        name: "description",
        content: "Browse upcoming football fixtures, model probabilities, recent form, and competition filters.",
      },
      { property: "og:title", content: "Upcoming Fixtures & Predictions | Touchline" },
      {
        property: "og:description",
        content: "Browse upcoming football fixtures, model probabilities, recent form, and competition filters.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FixturesPage,
});

function FixturesList({
  params,
  page,
  onPageChange,
}: {
  params: UpcomingMatchParams;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const { data: response } = useSuspenseQuery(upcomingMatchesQueryOptions(params));
  const matches = response.data;
  const totalPages = Math.max(response.meta?.total_pages ?? 1, 1);

  if (matches.length === 0) {
    return (
      <EmptyState
        title="No upcoming matches for these filters"
        message="Try a different date, competition, or team name. Fixtures appear here when the data feed provides them."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>Upcoming fixtures</span>
        {response.meta && <span>{response.meta.total} matches</span>}
      </div>
      <div className="space-y-3">
        {matches.map((match) => <FixtureCard key={match.id} match={match} />)}
      </div>
      <PaginationControls page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  );
}

function FixturesPage() {
  const filters = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const [searchValue, setSearchValue] = useState(filters.search ?? "");

  useEffect(() => setSearchValue(filters.search ?? ""), [filters.search]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextSearch = searchValue.trim().slice(0, 50) || undefined;
      void navigate({
        search: (current) =>
          current.search === nextSearch
            ? current
            : { ...current, search: nextSearch, page: 1 },
      });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [navigate, searchValue]);

  const params: UpcomingMatchParams = {
    page: filters.page,
    limit: 20,
    ...(filters.league !== undefined ? { league: filters.league } : {}),
    ...(filters.date ? { date: filters.date } : { window: filters.window }),
    ...(filters.search ? { search: filters.search } : {}),
  };

  const updateFilters = (patch: Partial<FixtureSearch>) => {
    void navigate({ search: (current) => ({ ...current, ...patch }) });
  };

  return (
    <div>
      <PageHeading
        eyebrow="The matchday board"
        title="Fixtures"
        description="Upcoming matches, recent form, and the model’s pre-match probabilities."
      />

      <section className="mb-7 border-b border-border pb-6" aria-label="Fixture filters">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1.2fr)_minmax(10rem,1fr)_minmax(10rem,0.8fr)_minmax(14rem,1.3fr)]">
          <QueryBoundary compact loadingRows={1}>
            <LeagueFilter
              value={filters.league}
              onChange={(league) => updateFilters({ league, page: 1 })}
            />
          </QueryBoundary>
          <div className="space-y-1.5">
            <label htmlFor="fixture-date" className="text-xs font-medium text-muted-foreground">
              Match date
            </label>
            <Input
              id="fixture-date"
              type="date"
              value={filters.date ?? ""}
              onChange={(event) => updateFilters({ date: event.target.value || undefined, page: 1 })}
              className="h-9 bg-card text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="fixture-window">
              Days ahead
            </label>
            <Select
              value={String(filters.window)}
              onValueChange={(value) => updateFilters({ window: Number(value), page: 1 })}
              disabled={Boolean(filters.date)}
            >
              <SelectTrigger id="fixture-window" aria-label="Days ahead">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[7, 14, 30, 60].map((days) => (
                  <SelectItem value={String(days)} key={days}>{days} days</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="team-search" className="text-xs font-medium text-muted-foreground">
              Search teams
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="team-search"
                type="search"
                maxLength={50}
                placeholder="Search a team"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                className="h-9 bg-card pl-9 text-sm"
              />
            </div>
          </div>
        </div>
        {filters.date && (
          <Button
            className="mt-3 px-0 text-xs"
            variant="link"
            size="sm"
            onClick={() => updateFilters({ date: undefined, page: 1 })}
          >
            Clear date and use the selected window
          </Button>
        )}
      </section>

      <QueryBoundary loadingRows={4}>
        <FixturesList
          params={params}
          page={filters.page}
          onPageChange={(page) => updateFilters({ page })}
        />
      </QueryBoundary>
    </div>
  );
}