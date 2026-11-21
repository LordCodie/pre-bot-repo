export type Outcome = "H" | "D" | "A";

export interface Prediction {
  home_win_prob: number;
  draw_prob: number;
  away_win_prob: number;
  predicted_outcome: Outcome;
  model_version: string;
  created_at: string;
}

export interface PredictionResult extends Prediction {
  match_id: number;
  source: "live" | "cache" | "database";
  warning?: string;
}

export interface TeamStatsSnapshot {
  team_id: number;
  as_of_date: string;
  games_played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  goals_for: number | null;
  goals_against: number | null;
  home_ppg: number | null;
  away_ppg: number | null;
  form_last5: string | null;
  points: number | null;
  ppg: number | null;
  clean_sheets: number | null;
  scoring_rate: number | null;
}

export interface Record5 {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  ppg: number | null;
}

export interface League {
  id: number;
  name: string;
  country: string;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface ApiResponse<T> {
  data: T;
  meta?: PageMeta;
}

export interface UpcomingMatch {
  id: number;
  league_id: number;
  league_name: string;
  country: string;
  match_date: string;
  status: "scheduled";
  home_team_id: number;
  home_team: string;
  away_team_id: number;
  away_team: string;
  home_team_home_ppg: number | null;
  home_form: string | null;
  away_team_away_ppg: number | null;
  away_form: string | null;
  prediction: Prediction | null;
}

export interface RecentMatch {
  id: number;
  match_date: string;
  status: "finished";
  home_goals: number;
  away_goals: number;
  league: League;
  home_team: { id: number; name: string };
  away_team: { id: number; name: string };
  actual_outcome: Outcome;
  prediction: Prediction | null;
  prediction_correct: boolean | null;
}

export interface TeamSummary {
  id: number;
  name: string;
}

export interface MatchDetail {
  id: number;
  match_date: string;
  status: "scheduled" | "finished";
  home_goals: number | null;
  away_goals: number | null;
  final_score: { home_goals: number; away_goals: number } | null;
  league: League;
  home_team: TeamSummary;
  away_team: TeamSummary;
  home: {
    team: unknown;
    stats: TeamStatsSnapshot | null;
    recent_form: string;
  };
  away: {
    team: unknown;
    stats: TeamStatsSnapshot | null;
    recent_form: string;
  };
  prediction: Prediction | null;
  prediction_history: Prediction[];
}

export interface TeamRecentMatch {
  id: number;
  match_date: string;
  home_team_id: number;
  away_team_id: number;
  home_goals: number;
  away_goals: number;
}

export interface TeamStats {
  team: {
    id: number;
    name: string;
    normalized_name: string;
    league: League;
  };
  snapshot: TeamStatsSnapshot | null;
  recent_form: string;
  recent_matches: TeamRecentMatch[];
  computed: {
    sample_size: number;
    overall: Record5;
    home: Record5;
    away: Record5;
  };
}

export interface AccuracyRow {
  model_version: string;
  total_predictions: number;
  correct_predictions: number;
  accuracy: number;
  brier_score: number;
  log_loss: number;
}

export interface AccuracyData {
  overall: AccuracyRow[];
  per_league: (AccuracyRow & { league_id: number; league_name: string })[];
  note: string;
}

export interface ScraperSource {
  id: number;
  league_id: number;
  source_url: string;
  status: "success" | "partial" | "failed";
  rows_upserted: number;
  error_message: string | null;
  ran_at: string;
}

export interface ScraperStatus {
  latest_per_source: ScraperSource[];
  last_successful_update: {
    ran_at: string;
    source_url: string;
    rows_upserted: number;
  } | null;
  recent_errors: unknown[];
}

export interface HealthStatus {
  status: "ok" | "degraded";
  timestamp: string;
  database?: "up" | "down";
  ml_service?: "up" | "up_no_model" | "down";
}

export interface UpcomingMatchParams {
  league?: number;
  date?: string;
  window?: number;
  search?: string;
  page?: number;
  limit?: number;
}

export interface RecentMatchParams {
  league?: number;
  page?: number;
  limit?: number;
}