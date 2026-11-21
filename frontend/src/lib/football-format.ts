import type { Outcome, Prediction } from "@/api/types";

export type FormCode = "W" | "D" | "L";

export function probabilityPercentages(prediction: Prediction | null) {
  if (!prediction) return null;
  const probabilities = [
    Number(prediction.home_win_prob),
    Number(prediction.draw_prob),
    Number(prediction.away_win_prob),
  ].map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;

  const exact = probabilities.map((value) => (value / total) * 100);
  const rounded = exact.map(Math.floor);
  let remaining = 100 - rounded.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder);

  for (let index = 0; index < remaining; index += 1) {
    const next = order[index % order.length];
    if (next) rounded[next.index] = (rounded[next.index] ?? 0) + 1;
  }
  remaining = 100 - rounded.reduce((sum, value) => sum + value, 0);
  if (remaining !== 0) return null;

  return { home: rounded[0] ?? 0, draw: rounded[1] ?? 0, away: rounded[2] ?? 0 };
}

export function formCodes(form: string | null | undefined): FormCode[] {
  if (!form) return [];
  return [...form].filter((value): value is FormCode => value === "W" || value === "D" || value === "L");
}

export function outcomeLabel(outcome: Outcome | null | undefined) {
  if (outcome === "H") return "Home win";
  if (outcome === "D") return "Draw";
  if (outcome === "A") return "Away win";
  return "Unavailable";
}

export function formatKickoff(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  // A midnight UTC kickoff is treated as a date-only value when scraper data omits the time.
  if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0) {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatNumber(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(Number(value));
}

export function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: digits,
  }).format(Number(value));
}

export function formatScore(homeGoals: number | null, awayGoals: number | null) {
  if (homeGoals === null || awayGoals === null) return "—";
  return `${homeGoals}–${awayGoals}`;
}