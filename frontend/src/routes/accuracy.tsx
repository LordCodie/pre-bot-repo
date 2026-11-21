import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { accuracyQueryOptions } from "@/api/queries";
import { EmptyState, QueryBoundary } from "@/components/football-ui";
import { PageHeading } from "@/components/football-data-components";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber, formatPercent } from "@/lib/football-format";

export const Route = createFileRoute("/accuracy")({
  head: () => ({
    meta: [
      { title: "Historical Prediction Accuracy | Touchline" },
      {
        name: "description",
        content: "Compare historical football prediction accuracy, Brier score, and log loss by model and league.",
      },
      { property: "og:title", content: "Historical Prediction Accuracy | Touchline" },
      {
        property: "og:description",
        content: "Compare historical football prediction accuracy, Brier score, and log loss by model and league.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AccuracyPage,
});

function AccuracyTable({
  rows,
  leagueColumn = false,
}: {
  rows: {
    model_version: string;
    total_predictions: number;
    correct_predictions: number;
    accuracy: number;
    brier_score: number;
    log_loss: number;
    league_name?: string;
  }[];
  leagueColumn?: boolean;
}) {
  return (
    <div className="overflow-x-auto border-y border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {leagueColumn && <TableHead>Competition</TableHead>}
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Predictions</TableHead>
            <TableHead className="text-right">Correct</TableHead>
            <TableHead className="text-right">Accuracy</TableHead>
            <TableHead className="text-right">Brier score</TableHead>
            <TableHead className="text-right">Log loss</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.league_name ?? "overall"}-${row.model_version}`}>
              {leagueColumn && <TableCell className="font-medium">{row.league_name}</TableCell>}
              <TableCell className="font-medium">{row.model_version}</TableCell>
              <TableCell className="text-right tabular-nums">{row.total_predictions}</TableCell>
              <TableCell className="text-right tabular-nums">{row.correct_predictions}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatPercent(row.accuracy)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(row.brier_score, 3)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(row.log_loss, 3)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AccuracyContent() {
  const { data } = useSuspenseQuery(accuracyQueryOptions());

  return (
    <div className="space-y-9">
      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-2xl text-foreground">Overall by model</h2>
          <span className="text-xs text-muted-foreground">Stored pre-kickoff predictions only</span>
        </div>
        {data.overall.length ? (
          <AccuracyTable rows={data.overall} />
        ) : (
          <EmptyState title="No accuracy data yet" message="Historical prediction records will appear when the server has eligible results." />
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-2xl text-foreground">By competition</h2>
          <span className="text-xs text-muted-foreground">Brier score and log loss are shown as returned by the server</span>
        </div>
        {data.per_league.length ? (
          <AccuracyTable rows={data.per_league} leagueColumn />
        ) : (
          <EmptyState title="No competition-level accuracy data" message="This breakdown will appear when eligible predictions are available for a competition." />
        )}
      </section>

      <p className="border-l-2 border-accent py-1 pl-3 text-sm text-muted-foreground">{data.note}</p>
      <p className="text-xs text-muted-foreground">Historical metrics describe past predictions and do not guarantee future results.</p>
    </div>
  );
}

function AccuracyPage() {
  return (
    <div>
      <PageHeading
        eyebrow="Model record"
        title="Prediction accuracy"
        description="Historical performance for predictions stored before kickoff. These figures are descriptive, not promises."
      />
      <QueryBoundary loadingRows={4}>
        <AccuracyContent />
      </QueryBoundary>
    </div>
  );
}