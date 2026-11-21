import { Link } from "@tanstack/react-router";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { leaguesQueryOptions } from "@/api/queries";
import type { RecentMatch, UpcomingMatch } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormBadges, ProbabilityBreakdown } from "@/components/football-ui";
import { formatKickoff, formatScore, outcomeLabel } from "@/lib/football-format";

export function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-7 border-b border-border pb-5 sm:mb-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
      <h1 className="mt-1 text-4xl leading-none text-foreground sm:text-5xl">{title}</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function LeagueFilter({
  value,
  onChange,
  label = "Competition",
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  label?: string;
}) {
  const { data: leagues } = useSuspenseQuery(leaguesQueryOptions());

  return (
    <div className="min-w-0 space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Select
        value={value === undefined ? "all" : String(value)}
        onValueChange={(selected) => onChange(selected === "all" ? undefined : Number(selected))}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder="All competitions" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All competitions</SelectItem>
          {leagues.map((league) => (
            <SelectItem value={String(league.id)} key={league.id}>
              {league.name} · {league.country}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function FixtureCard({ match }: { match: UpcomingMatch }) {
  return (
    <Link
      to="/matches/$id"
      params={{ id: String(match.id) }}
      className="group block border border-border bg-card p-4 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
      aria-label={`Open ${match.home_team} versus ${match.away_team}`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {match.league_name} <span className="font-normal">· {match.country}</span>
        </p>
        <time className="shrink-0 text-xs font-medium text-foreground" dateTime={match.match_date}>
          {formatKickoff(match.match_date)}
        </time>
      </div>

      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(15rem,0.82fr)] md:gap-7">
        <div className="space-y-4">
          <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3">
            <p className="truncate text-lg font-semibold text-foreground group-hover:text-primary sm:text-xl">
              {match.home_team}
            </p>
            <div className="justify-self-end">
              <FormBadges form={match.home_form} />
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3">
            <p className="truncate text-lg font-semibold text-foreground group-hover:text-primary sm:text-xl">
              {match.away_team}
            </p>
            <div className="justify-self-end">
              <FormBadges form={match.away_form} />
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-4 md:border-l md:border-t-0 md:pl-6 md:pt-0">
          <ProbabilityBreakdown prediction={match.prediction} />
        </div>
      </div>
    </Link>
  );
}

export function RecentMatchCard({ match }: { match: RecentMatch }) {
  const resultLabel =
    match.prediction && match.prediction_correct !== null
      ? match.prediction_correct
        ? "Correct"
        : "Incorrect"
      : "No pre-kickoff prediction";

  return (
    <article className="border border-border bg-card p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {match.league.name} <span className="font-normal">· {match.league.country}</span>
        </p>
        <time className="shrink-0 text-xs text-muted-foreground" dateTime={match.match_date}>
          {formatKickoff(match.match_date)}
        </time>
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <Link
              to="/teams/$id"
              params={{ id: String(match.home_team.id) }}
              className="block truncate font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline"
            >
              {match.home_team.name}
            </Link>
            <Link
              to="/teams/$id"
              params={{ id: String(match.away_team.id) }}
              className="block truncate font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline"
            >
              {match.away_team.name}
            </Link>
          </div>
          <span className="shrink-0 font-display text-3xl font-semibold tabular-nums text-foreground">
            {formatScore(match.home_goals, match.away_goals)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="text-muted-foreground">
            Predicted: <span className="font-medium text-foreground">
              {match.prediction ? outcomeLabel(match.prediction.predicted_outcome) : "—"}
            </span>
          </span>
          <span className="text-muted-foreground">
            Actual: <span className="font-medium text-foreground">{outcomeLabel(match.actual_outcome)}</span>
          </span>
          <Badge
            variant="outline"
            className={
              resultLabel === "Correct"
                ? "border-success/30 bg-success/10 text-success"
                : resultLabel === "Incorrect"
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border bg-muted text-muted-foreground"
            }
          >
            {resultLabel === "Correct" && <Check aria-hidden="true" />}
            {resultLabel === "Incorrect" && <X aria-hidden="true" />}
            {resultLabel}
          </Badge>
        </div>
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <Link
          to="/matches/$id"
          params={{ id: String(match.id) }}
          className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
        >
          Match details
        </Link>
      </div>
    </article>
  );
}

export function PaginationControls({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav className="flex items-center justify-between gap-3 border-t border-border pt-4" aria-label="Pages">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
      >
        <ChevronLeft aria-hidden="true" />
        Previous
      </Button>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Page <span className="font-semibold text-foreground">{page}</span> of {totalPages}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
      >
        Next
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}