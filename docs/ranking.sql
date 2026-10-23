-- Ranking global (src/net/rankingApi.ts). Mismo proyecto de Supabase que la galería
-- (docs/comunidad.sql). Pegar completo en Supabase → SQL Editor → Run. Se puede volver a correr.
--
-- La página nunca escribe las tablas directo: todo pasa por funciones que validan.
--   · register_player(name, token)         crea la cuenta; el token (secreto) se guarda solo como hash
--   · rename_player(pid, token, name)      cambia el nombre
--   · delete_player(pid, token)            borra la cuenta y sus matches (salir del ranking)
--   · submit_match(pid, token, m)          valida el match, calcula el rating AQUÍ (no lo manda la
--                                           página) y actualiza los acumulados
--   · leaderboard(sort, lim) / player_rank  lectura pública
-- Límites contra trampas: un match cada 140 s por cuenta (un match dura 2:40), números dentro de
-- lo posible en REBUILT (FUEL ≤ tiros, FUEL + TOWER ≤ puntos de la alianza, TOWER válido por
-- robot…), fechas de las últimas 24 h y nunca antes que el match anterior.
-- Moderación: Table Editor → players: `banned = true` lo saca del ranking y le impide enviar.

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 24),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  banned boolean not null default false,
  rating int not null default 1200,
  peak int not null default 1200,
  matches int not null default 0,
  wins int not null default 0,
  ties int not null default 0,
  fuel int not null default 0,
  shots int not null default 0,
  cycles int not null default 0,
  tower int not null default 0,
  climbs int not null default 0,
  foul_pts int not null default 0,
  points int not null default 0,
  best int not null default 0,
  robot text not null default '' check (char_length(robot) <= 40),
  team int not null default 0,
  last_played timestamptz
);

create table if not exists public.matches (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  received_at timestamptz not null default now(),
  played_at timestamptz not null,
  mode text not null,
  difficulty text not null,
  outcome char(1) not null,
  score int not null,
  opp_score int not null,
  fuel int not null,
  shots int not null,
  cycles int not null,
  tower int not null,
  level int not null,
  foul_pts int not null,
  robot text not null,
  team int not null,
  opp_rating int not null,
  rating int not null,
  delta int not null
);
create index if not exists matches_player on public.matches (player_id, played_at desc);
create index if not exists players_rating on public.players (rating desc) where not banned and matches > 0;

alter table public.players enable row level security;
alter table public.matches enable row level security;
revoke all on public.players, public.matches from anon, authenticated;
-- Solo lectura de las columnas públicas (sin token_hash)
grant select (id, name, rating, peak, matches, wins, ties, fuel, shots, cycles, tower, climbs, foul_pts, points, best, robot, team, last_played)
  on public.players to anon, authenticated;
drop policy if exists "players: leer" on public.players;
create policy "players: leer" on public.players for select to anon, authenticated using (not banned and matches > 0);

create or replace function public._rk_hash(token text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(token, 'sha256'), 'hex');
$$;

create or replace function public._rk_name(n text) returns text
language sql immutable as $$
  select left(btrim(regexp_replace(coalesce(n, ''), '[[:cntrl:]]', '', 'g')), 24);
$$;

create or replace function public.register_player(name text, token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid; n text := _rk_name(name);
begin
  if n = '' then raise exception 'name'; end if;
  if token is null or char_length(token) < 32 or char_length(token) > 128 then raise exception 'token'; end if;
  insert into players (name, token_hash) values (n, _rk_hash(token)) returning id into pid;
  return pid;
end $$;

create or replace function public.rename_player(pid uuid, token text, name text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n text := _rk_name(name); c int;
begin
  if n = '' then raise exception 'name'; end if;
  update players set name = n where id = pid and token_hash = _rk_hash(token);
  get diagnostics c = row_count;
  return c > 0;
end $$;

create or replace function public.delete_player(pid uuid, token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  delete from players where id = pid and token_hash = _rk_hash(token);
  get diagnostics c = row_count;
  return c > 0;
end $$;

-- m: {played_at, mode, difficulty, score, opp_score, fuel, shots, cycles, tower, level, foul_pts,
--     robot, team, opp_humans, opp_count}
create or replace function public.submit_match(pid uuid, token text, m jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p players%rowtype;
  v_played timestamptz;
  v_mode text := m->>'mode';
  v_diff text := m->>'difficulty';
  v_score int := (m->>'score')::int;
  v_opp int := (m->>'opp_score')::int;
  v_fuel int := (m->>'fuel')::int;
  v_shots int := (m->>'shots')::int;
  v_cycles int := (m->>'cycles')::int;
  v_tower int := (m->>'tower')::int;
  v_level int := (m->>'level')::int;
  v_fouls int := (m->>'foul_pts')::int;
  v_humans int := coalesce((m->>'opp_humans')::int, 0);
  v_nopp int := coalesce((m->>'opp_count')::int, 3);
  v_robot text := left(coalesce(m->>'robot', ''), 40);
  v_team int := coalesce((m->>'team')::int, 0);
  v_outcome char(1);
  v_ai int;
  v_oppr numeric;
  v_exp numeric;
  v_next int;
  v_pts int;
begin
  select * into p from players where id = pid and token_hash = _rk_hash(token) for update;
  if not found then raise exception 'auth'; end if;
  if p.banned then raise exception 'banned'; end if;
  v_played := least(now(), (m->>'played_at')::timestamptz);
  if v_played < now() - interval '24 hours' then raise exception 'old'; end if;
  if p.last_played is not null and v_played < p.last_played + interval '140 seconds' then raise exception 'too-soon'; end if;
  if v_mode is null or v_mode not in ('match', 'local', 'tournament', 'online') then raise exception 'mode'; end if;
  v_ai := case v_diff when 'easy' then 950 when 'normal' then 1150 when 'hard' then 1350 when 'einstein' then 1550 end;
  if v_ai is null then raise exception 'difficulty'; end if;
  -- Números posibles en REBUILT: 504/600 FUEL en el campo; TOWER por robot = AUTO L1 (15) + un nivel en TELEOP (10/20/30)
  if v_score is null or v_opp is null or v_score not between 0 and 1500 or v_opp not between 0 and 1500 then raise exception 'score'; end if;
  if v_fuel is null or v_shots is null or v_fuel not between 0 and 600 or v_shots not between v_fuel and 2000 then raise exception 'fuel'; end if;
  if v_cycles is null or v_cycles not between 0 and 80 or (v_fuel > 0 and v_cycles = 0) then raise exception 'cycles'; end if;
  if v_tower is null or v_tower not in (0, 10, 15, 20, 25, 30, 35, 45) or v_level is null or v_level not between 0 and 3 then raise exception 'tower'; end if;
  if v_fouls is null or v_fouls not between 0 and 600 or v_fouls % 5 <> 0 then raise exception 'fouls'; end if;
  -- lo que anotó el robot cabe en el marcador de su alianza (0 = alianza descalificada en Playoffs)
  if v_score > 0 and v_fuel + v_tower > v_score then raise exception 'sum'; end if;
  if v_humans not between 0 and 3 or v_nopp not between 1 and 3 or v_humans > v_nopp then raise exception 'opponents'; end if;
  if v_team not between 0 and 99999 then raise exception 'team'; end if;
  v_outcome := case when v_score > v_opp then 'W' when v_score < v_opp then 'L' else 'T' end;
  -- Elo (igual que src/core/stats.ts): rival = IA por dificultad o 1200 si es una persona
  v_oppr := (v_humans * 1200 + (v_nopp - v_humans) * v_ai)::numeric / v_nopp;
  v_exp := 1 / (1 + power(10::numeric, (v_oppr - p.rating) / 400));
  v_next := round(p.rating + (case when p.matches < 10 then 48 else 24 end) * ((case v_outcome when 'W' then 1 when 'T' then 0.5 else 0 end) - v_exp));
  v_pts := v_fuel + v_tower - v_fouls;
  update players set
    rating = v_next, peak = greatest(peak, v_next), matches = matches + 1,
    wins = wins + (v_outcome = 'W')::int, ties = ties + (v_outcome = 'T')::int,
    fuel = fuel + v_fuel, shots = shots + v_shots, cycles = cycles + v_cycles, tower = tower + v_tower,
    climbs = climbs + (v_level > 0)::int, foul_pts = foul_pts + v_fouls, points = points + v_pts,
    best = case when matches = 0 then v_pts else greatest(best, v_pts) end,
    robot = v_robot, team = v_team, last_played = v_played
  where id = pid;
  insert into matches (player_id, played_at, mode, difficulty, outcome, score, opp_score, fuel, shots, cycles, tower, level, foul_pts, robot, team, opp_rating, rating, delta)
  values (pid, v_played, v_mode, v_diff, v_outcome, v_score, v_opp, v_fuel, v_shots, v_cycles, v_tower, v_level, v_fouls, v_robot, v_team, round(v_oppr), v_next, v_next - p.rating);
  return jsonb_build_object('rating', v_next, 'delta', v_next - p.rating, 'matches', p.matches + 1);
end $$;

-- Ranking: sort = rating | points | fuel | accuracy | cycles | matches (promedios por match)
create or replace function public.leaderboard(sort text default 'rating', lim int default 100) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', id, 'name', name, 'rating', rating, 'peak', peak, 'matches', matches, 'wins', wins,
    'winRate', round((wins + ties / 2.0) / matches, 3),
    'avgPoints', round(points::numeric / matches, 1), 'avgFuel', round(fuel::numeric / matches, 1),
    'accuracy', case when shots > 0 then round(least(1, fuel::numeric / shots), 3) else 0 end,
    'avgCycles', round(cycles::numeric / matches, 1), 'climbRate', round(climbs::numeric / matches, 3),
    'robot', robot, 'team', team, 'ts', extract(epoch from last_played) * 1000)
  from players
  where not banned and matches > 0 and last_played > now() - interval '120 days'
  order by
    case sort
      when 'points' then points::numeric / matches
      when 'fuel' then fuel::numeric / matches
      when 'accuracy' then case when matches >= 3 and shots > 0 then fuel::numeric / shots else -1 end
      when 'cycles' then cycles::numeric / matches
      when 'matches' then matches
      else rating
    end desc, rating desc, matches desc
  limit least(greatest(lim, 1), 200);
$$;

-- Lugar de un jugador por rating (1 = primero) y total de jugadores en el ranking
create or replace function public.player_rank(pid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select rating from players where id = pid),
       board as (select rating from players where not banned and matches > 0 and last_played > now() - interval '120 days')
  select jsonb_build_object(
    'rank', (select count(*) + 1 from board, me where board.rating > me.rating),
    'total', (select count(*) from board));
$$;

revoke all on function public._rk_hash(text), public._rk_name(text) from public, anon, authenticated;
revoke all on function public.register_player(text, text), public.rename_player(uuid, text, text), public.delete_player(uuid, text),
  public.submit_match(uuid, text, jsonb), public.leaderboard(text, int), public.player_rank(uuid) from public;
grant execute on function public.register_player(text, text), public.rename_player(uuid, text, text), public.delete_player(uuid, text),
  public.submit_match(uuid, text, jsonb), public.leaderboard(text, int), public.player_rank(uuid) to anon, authenticated;
