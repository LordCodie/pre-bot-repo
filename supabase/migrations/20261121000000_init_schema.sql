-- Football Match Prediction Platform: schema (Supabase / PostgreSQL 15+)
-- Applied automatically by `supabase db reset` (local) or pasted into the SQL editor.
-- Idempotent where practical.

create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

-- ───────────── tables ─────────────
create table if not exists leagues (
  id          bigserial primary key,
  name        text not null,
  country     text,
  source_url  text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists teams (
  id               bigserial primary key,
  league_id        bigint not null references leagues(id) on delete cascade,
  name             text not null,                 -- name as scraped
  normalized_name  text not null,                 -- canonical name (alias-mapped)
  created_at       timestamptz not null default now(),
  unique (league_id, normalized_name)
);

create table if not exists matches (
  id            bigserial primary key,
  league_id     bigint not null references leagues(id) on delete cascade,
  match_date    timestamptz not null,             -- date + kickoff (00:00 in source tz if kickoff unknown)
  home_team_id  bigint not null references teams(id) on delete cascade,
  away_team_id  bigint not null references teams(id) on delete cascade,
  home_goals    integer check (home_goals >= 0),
  away_goals    integer check (away_goals >= 0),
  status        text not null default 'scheduled' check (status in ('scheduled','finished')),
  updated_at    timestamptz not null default now(),
  constraint matches_distinct_teams check (home_team_id <> away_team_id),
  constraint matches_finished_has_score check
    (status <> 'finished' or (home_goals is not null and away_goals is not null)),
  constraint matches_unique unique (league_id, match_date, home_team_id, away_team_id)
);

create table if not exists team_stats (
  id             bigserial primary key,
  team_id        bigint not null references teams(id) on delete cascade,
  as_of_date     date not null,
  games_played   integer check (games_played >= 0),
  wins           integer check (wins >= 0),
  draws          integer check (draws >= 0),
  losses         integer check (losses >= 0),
  goals_for      integer check (goals_for >= 0),
  goals_against  integer check (goals_against >= 0),
  home_ppg       numeric(4,2) check (home_ppg between 0 and 3),
  away_ppg       numeric(4,2) check (away_ppg between 0 and 3),
  form_last5     text,
  -- Additive, nullable columns for source values the scraper scope asks to preserve:
  points         integer,
  ppg            numeric(4,2),
  clean_sheets   numeric(6,2),
  scoring_rate   numeric(6,2),
  created_at     timestamptz not null default now(),
  unique (team_id, as_of_date)
);

create table if not exists predictions (
  id                 bigserial primary key,
  match_id           bigint not null references matches(id) on delete cascade,
  model_version      text not null,
  home_win_prob      numeric(7,6) not null check (home_win_prob between 0 and 1),
  draw_prob          numeric(7,6) not null check (draw_prob between 0 and 1),
  away_win_prob      numeric(7,6) not null check (away_win_prob between 0 and 1),
  predicted_outcome  char(1) not null check (predicted_outcome in ('H','D','A')),
  created_at         timestamptz not null default now(),
  unique (match_id, model_version),               -- new model versions add rows; old ones are kept
  constraint predictions_sum_to_one check (abs(home_win_prob + draw_prob + away_win_prob - 1) <= 0.001)
);

create table if not exists scrape_logs (
  id             bigserial primary key,
  league_id      bigint references leagues(id) on delete set null,
  source_url     text not null,
  status         text not null check (status in ('success','partial','failed')),
  rows_upserted  integer not null default 0,
  error_message  text,
  ran_at         timestamptz not null default now()
);

-- ───────────── indexes (driven by actual query patterns) ─────────────
create index if not exists idx_matches_status_date  on matches (status, match_date);
create index if not exists idx_matches_league_date  on matches (league_id, match_date);
create index if not exists idx_matches_home_date    on matches (home_team_id, match_date desc);
create index if not exists idx_matches_away_date    on matches (away_team_id, match_date desc);
create index if not exists idx_matches_finished     on matches (match_date) where status = 'finished'; -- ML training
create index if not exists idx_predictions_match    on predictions (match_id, created_at desc);
create index if not exists idx_team_stats_team_date on team_stats (team_id, as_of_date desc);
create index if not exists idx_scrape_logs_ran_at   on scrape_logs (ran_at desc);
create index if not exists idx_teams_league         on teams (league_id);

-- ───────────── triggers ─────────────
drop trigger if exists trg_matches_updated on matches;
create trigger trg_matches_updated before update on matches
  for each row execute function set_updated_at();

-- Never let a re-scrape of a stale fixture page turn a finished match back into 'scheduled'.
create or replace function protect_finished_matches() returns trigger as $$
begin
  if old.status = 'finished' and new.status = 'scheduled' then
    new.status := old.status; new.home_goals := old.home_goals; new.away_goals := old.away_goals;
  end if;
  return new;
end; $$ language plpgsql;
drop trigger if exists trg_matches_protect on matches;
create trigger trg_matches_protect before update on matches
  for each row execute function protect_finished_matches();

-- ───────────── views (security_invoker: RLS of the caller applies) ─────────────
create or replace view v_upcoming_matches with (security_invoker = true) as
select m.id, m.league_id, l.name as league_name, l.country, m.match_date, m.status,
       m.home_team_id, ht.name as home_team, m.away_team_id, awt.name as away_team,
       hs.home_ppg as home_team_home_ppg, hs.form_last5 as home_form,
       aws.away_ppg as away_team_away_ppg, aws.form_last5 as away_form
from matches m
join leagues l   on l.id   = m.league_id
join teams ht    on ht.id  = m.home_team_id
join teams awt   on awt.id = m.away_team_id
left join lateral (select s.home_ppg, s.form_last5 from team_stats s
                   where s.team_id = m.home_team_id order by s.as_of_date desc limit 1) hs on true
left join lateral (select s.away_ppg, s.form_last5 from team_stats s
                   where s.team_id = m.away_team_id order by s.as_of_date desc limit 1) aws on true
where m.status = 'scheduled';

create or replace view v_match_results with (security_invoker = true) as
select m.id as match_id, m.league_id, l.name as league_name, m.match_date,
       ht.name as home_team, awt.name as away_team, m.home_goals, m.away_goals,
       case when m.home_goals > m.away_goals then 'H'
            when m.home_goals = m.away_goals then 'D' else 'A' end as actual_outcome,
       p.model_version, p.home_win_prob, p.draw_prob, p.away_win_prob, p.predicted_outcome,
       p.created_at as predicted_at,
       (p.created_at < m.match_date) as predicted_before_kickoff,
       (p.predicted_outcome =
          case when m.home_goals > m.away_goals then 'H'
               when m.home_goals = m.away_goals then 'D' else 'A' end) as is_correct
from matches m
join leagues l   on l.id   = m.league_id
join teams ht    on ht.id  = m.home_team_id
join teams awt   on awt.id = m.away_team_id
left join predictions p on p.match_id = m.id
where m.status = 'finished';

-- Accuracy only counts predictions that existed before kickoff (no after-the-fact scoring).
-- Rows with league_id NULL are the overall figures for a model version.
create or replace view v_prediction_accuracy with (security_invoker = true) as
select league_id, max(league_name) as league_name, model_version,
       count(*) as total_predictions,
       sum(is_correct::int) as correct_predictions,
       round(avg(is_correct::int)::numeric, 4) as accuracy,
       round(avg(brier)::numeric, 4) as brier_score,
       round(avg(log_loss)::numeric, 4) as log_loss
from (
  select r.*,
    power(r.home_win_prob - (r.actual_outcome = 'H')::int, 2)
      + power(r.draw_prob - (r.actual_outcome = 'D')::int, 2)
      + power(r.away_win_prob - (r.actual_outcome = 'A')::int, 2) as brier,
    -ln(greatest(case r.actual_outcome when 'H' then r.home_win_prob
                                       when 'D' then r.draw_prob
                                       else r.away_win_prob end, 1e-15)) as log_loss
  from v_match_results r
  where r.model_version is not null and r.predicted_before_kickoff
) x
group by grouping sets ((model_version), (league_id, model_version));

create or replace view v_latest_scrape_status with (security_invoker = true) as
select distinct on (source_url) id, league_id, source_url, status, rows_upserted, error_message, ran_at
from scrape_logs order by source_url, ran_at desc;

-- ───────────── security ─────────────
-- Services use the service-role key (bypasses RLS). anon/authenticated get read-only access
-- to public football data; scrape_logs has no public policy at all.
do $$ declare t text; begin
  foreach t in array array['leagues','teams','matches','team_stats','predictions','scrape_logs'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
  foreach t in array array['leagues','teams','matches','team_stats','predictions'] loop
    execute format('drop policy if exists "public read" on %I', t);
    execute format('create policy "public read" on %I for select to anon, authenticated using (true)', t);
  end loop;
end $$;
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
