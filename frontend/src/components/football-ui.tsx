import { Component, Suspense, type ReactNode } from "react";
import { useQueryClient, useQueryErrorResetBoundary } from "@tanstack/react-query";
import { AlertCircle, RefreshCw } from "lucide-react";
import { ApiError } from "@/api/client";
import type { Outcome, Prediction } from "@/api/types";
import { formCodes, outcomeLabel, probabilityPercentages } from "@/lib/football-format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorBoundaryProps {
  children: ReactNode;
  onRetry: () => void;
  fallback: (error: unknown, retry: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: unknown | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  retry = () => {
    this.props.onRetry();
    this.setState({ error: null });
  };

  render() {
    if (this.state.error !== null) return this.props.fallback(this.state.error, this.retry);
    return this.props.children;
  }
}

export function QueryBoundary({
  children,
  compact = false,
  loadingRows = 3,
}: {
  children: ReactNode;
  compact?: boolean;
  loadingRows?: number;
}) {
  const queryClient = useQueryClient();
  const queryErrorReset = useQueryErrorResetBoundary();

  return (
    <ErrorBoundary
      onRetry={() => {
        queryErrorReset.reset();
        void queryClient.invalidateQueries();
      }}
      fallback={(error, retry) => <ErrorState error={error} onRetry={retry} compact={compact} />}
    >
      <Suspense fallback={<LoadingState rows={loadingRows} compact={compact} />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

export function LoadingState({ rows = 3, compact = false }: { rows?: number; compact?: boolean }) {
  return (
    <div className={cn("space-y-3", compact ? "py-2" : "py-5")} role="status" aria-live="polite">
      <span className="sr-only">Loading match data</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          className={cn("football-skeleton rounded-md", compact ? "h-3 w-40" : "h-20 w-full")}
          aria-hidden="true"
          key={index}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="border-y border-border py-10 text-center" role="status">
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  compact = false,
}: {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const code = error instanceof ApiError ? error.code : "";
  const apiMessage = error instanceof Error ? error.message : "The request could not be completed.";
  const title =
    code === "rate_limited"
      ? "Please give the data feed a moment"
      : code === "network_error"
        ? "Match data is temporarily unreachable"
        : code === "ml_service_error" || code === "ml_service_unavailable"
          ? "Predictions are temporarily unavailable"
          : "This data could not be loaded";
  const description =
    code === "rate_limited"
      ? "The service is receiving too many requests. Wait briefly, then try again."
      : code === "network_error"
        ? "The match data server could not be reached. Check that it is running, then retry."
        : code === "ml_service_error" || code === "ml_service_unavailable"
          ? "The prediction service is unavailable right now. Match information may still be available."
          : apiMessage;

  return (
    <div
      className={cn(
        "flex items-start gap-3 border border-destructive/30 bg-destructive/5 text-foreground",
        compact ? "p-3" : "p-5",
      )}
      role="alert"
    >
      <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 break-words text-sm text-muted-foreground">{description}</p>
        {code && code !== "network_error" && code !== "rate_limited" && (
          <p className="mt-1 break-words text-xs text-muted-foreground">{apiMessage}</p>
        )}
        {onRetry && (
          <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

const FORM_STYLES = {
  W: "border-success/25 bg-success/10 text-success",
  D: "border-warning/40 bg-warning/15 text-foreground",
  L: "border-destructive/25 bg-destructive/10 text-destructive",
} as const;

export function FormBadges({
  form,
  sourceLabel,
}: {
  form: string | null | undefined;
  sourceLabel?: string;
}) {
  const codes = formCodes(form);
  const names = { W: "Win", D: "Draw", L: "Loss" } as const;

  return (
    <div className="flex min-h-6 flex-wrap items-center gap-1.5">
      <div className="flex gap-1" aria-label={codes.length ? "Recent results, newest first" : "No recent form available"}>
        {codes.length ? (
          codes.map((code, index) => (
            <span
              className={cn("inline-flex size-6 items-center justify-center border text-xs font-bold", FORM_STYLES[code])}
              key={`${code}-${index}`}
              title={names[code]}
              aria-label={names[code]}
            >
              {code}
            </span>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </div>
      {sourceLabel && <span className="text-xs text-muted-foreground">{sourceLabel}</span>}
    </div>
  );
}

const OUTCOME_COLORS: Record<Outcome, string> = {
  H: "bg-home",
  D: "bg-draw",
  A: "bg-away",
};

export function ProbabilityBreakdown({ prediction }: { prediction: Prediction | null }) {
  const percentages = probabilityPercentages(prediction);
  if (!prediction || !percentages) {
    return (
      <p className="text-sm text-muted-foreground">No prediction available</p>
    );
  }

  const values = [percentages.home, percentages.draw, percentages.away];
  const outcomes: Outcome[] = ["H", "D", "A"];
  const labels = ["Home", "Draw", "Away"];

  return (
    <div className="space-y-2">
      <div
        className="flex h-2.5 overflow-hidden rounded-sm bg-muted"
        role="img"
        aria-label={`Prediction: home ${values[0]}%, draw ${values[1]}%, away ${values[2]}%`}
      >
        {outcomes.map((outcome, index) => (
          <span
            key={outcome}
            className={cn("h-full transition-[width]", OUTCOME_COLORS[outcome])}
            style={{ width: `${values[index] ?? 0}%` }}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {outcomes.map((outcome, index) => (
          <div
            className={cn(
              "min-w-0 border-l-2 pl-2",
              OUTCOME_COLORS[outcome].replace("bg-", "border-"),
              prediction.predicted_outcome === outcome && "font-semibold",
            )}
            key={outcome}
          >
            <span className="block text-xs text-muted-foreground">{labels[index]}</span>
            <span className="text-sm text-foreground">{values[index]}%</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Predicted: {outcomeLabel(prediction.predicted_outcome)}</span>
        <span>Model {prediction.model_version}</span>
      </div>
    </div>
  );
}