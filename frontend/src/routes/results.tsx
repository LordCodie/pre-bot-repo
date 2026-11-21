import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { RecentMatchParams } from "@/api/types";
import { recentMatchesQueryOptions } from "@/api/queries";
import {
  LeagueFilter,
  PageHeading,
  PaginationControls,
  RecentMatchCard,
} from "@/components/football-data-components";
import { EmptyState, QueryBoundary } from "@/components/football-ui";

export const Route = createFileRoute("/results")({
  head: () => ({
    meta: [
      { title: "Recent Results & Prediction Outcomes | Touchline" },
      {
        name: "description",
        content: "Review recent football scores and compare stored pre-kickoff predictions with actual outcomes.",
      },
      { property: "og:title", content: "Recent Results & Prediction Outcomes | Touchline" },
      {
        property: "og:description",
        content: "Review recent football scores and compare stored pre-kickoff predictions with actual outcomes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResultsPage,
});

function ResultsList({ params }: { params: RecentMatchParams }) {
  const { data: response } = useSuspenseQuery(recentMatchesQueryOptions(params));

  if (response.data.length === 0) {
    return (
      <EmptyState
        title="No recent results found"
        message="Finished matches will appear here when the server has stored results. No sample scores are shown."
      />
    );
  }

  return (
    <div className="space-y-3">
      {response.data.map((match) => <RecentMatchCard key={match.id} match={match} />)}
      <PaginationControls
        page={response.meta?.page ?? params.page ?? 1}
        totalPages={Math.max(response.meta?.total_pages ?? 1, 1)}
        onPageChange={(page) => params.onPageChange?.(page)}
      />
    </div>
  );
}

interface ResultsParams extends RecentMatchParams {
  onPageChange?: (page: number) => void;
}

function ResultsContent({ league, page, onPageChange }: ResultsParams) {
  const params: RecentMatchParams = { league, page, limit: 20 };
  const { data: response } = useSuspenseQuery(recentMatchesQueryOptions(params));

  if (response.data.length === 0) {
    return (
      <EmptyState
        title="No recent results found"
        message="Finished matches will appear here when the server has stored results. No sample scores are shown."
      />
    );
  }

  return (
    <div className="space-y-3">
      {response.data.map((match) => <RecentMatchCard key={match.id} match={match} />)}
      <PaginationControls
        page={response.meta?.page ?? page}
        totalPages={Math.max(response.meta?.total_pages ?? 1, 1)}
        onPageChange={onPageChange ?? (() => {})}
      />
    </div>
  );
}

function ResultsPage() {
  const [league, setLeague] = useState<number | undefined>();
  const [page, setPage] = useState(1);

  return (
    <div>
      <PageHeading
        eyebrow="Final whistle"
        title="Recent results"
        description="Final scores alongside the pre-kickoff call, when a prediction was stored."
      />
      <section className="mb-7 max-w-sm border-b border-border pb-5" aria-label="Result filters">
        <QueryBoundary compact loadingRows={1}>
          <LeagueFilter
            value={league}
            onChange={(nextLeague) => {
              setLeague(nextLeague);
              setPage(1);
            }}
          />
        </QueryBoundary>
      </section>
      <QueryBoundary loadingRows={4}>
        <ResultsContent league={league} page={page} onPageChange={setPage} />
      </QueryBoundary>
    </div>
  );
}