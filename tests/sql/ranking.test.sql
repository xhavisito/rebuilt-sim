-- Prueba de docs/ranking.sql en un Postgres local que imita a Supabase (roles anon/authenticated,
-- pgcrypto en el esquema extensions). Correr con scripts/test-ranking-sql.sh.
\set ON_ERROR_STOP 1
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public, extensions to anon, authenticated;
\i docs/ranking.sql
-- se puede volver a correr
\i docs/ranking.sql

create temp table out (k text, v text);
grant all on out to anon;
set role anon;

do $$
declare pid uuid; r jsonb; tok text := repeat('a', 40); ok boolean;
  base jsonb := jsonb_build_object('played_at', now() - interval '20 minutes', 'mode', 'match', 'difficulty', 'normal',
    'score', 90, 'opp_score', 60, 'fuel', 40, 'shots', 50, 'cycles', 6, 'tower', 25, 'level', 1, 'foul_pts', 5,
    'robot', '1678 Limestone', 'team', 1678, 'opp_humans', 0, 'opp_count', 3);
  procedure_err text;
begin
  pid := register_player('  Xhavi  ', tok);
  insert into out values ('registro', pid::text);
  r := submit_match(pid, tok, base);
  insert into out values ('match 1', r::text);
  -- contra IA normal (1150) desde 1200, K 48: 1200 + 48 * (1 - 1/(1+10^(-50/400)))
  if (r->>'rating')::int <> 1221 then raise exception 'elo %', r; end if;
  -- demasiado pronto (menos de 140 s después del anterior)
  begin
    perform submit_match(pid, tok, base || jsonb_build_object('played_at', now() - interval '19 minutes'));
    raise exception 'debió fallar: too-soon';
  exception when others then if sqlerrm <> 'too-soon' then raise; end if; end;
  -- trampas
  for procedure_err in select unnest(array['fuel','sum','tower','auth','mode','old','fouls','cycles']) loop
    begin
      perform submit_match(pid, case procedure_err when 'auth' then repeat('b', 40) else tok end,
        base || jsonb_build_object('played_at', now() - interval '10 minutes') || case procedure_err
          when 'fuel' then jsonb_build_object('fuel', 60, 'shots', 50)
          when 'sum' then jsonb_build_object('score', 30, 'opp_score', 20)
          when 'tower' then jsonb_build_object('tower', 50)
          when 'mode' then jsonb_build_object('mode', 'practice')
          when 'old' then jsonb_build_object('played_at', now() - interval '2 days')
          when 'fouls' then jsonb_build_object('foul_pts', 7)
          when 'cycles' then jsonb_build_object('cycles', 0)
          else '{}'::jsonb end);
      raise exception 'debió fallar: %', procedure_err;
    exception when others then
      if sqlerrm <> procedure_err then raise exception 'esperaba %, salió %', procedure_err, sqlerrm; end if;
    end;
  end loop;
  -- segundo match válido, perdido contra personas
  r := submit_match(pid, tok, base || jsonb_build_object('played_at', now() - interval '5 minutes', 'score', 50, 'opp_score', 80, 'fuel', 20, 'shots', 30, 'tower', 10, 'opp_humans', 3));
  insert into out values ('match 2', r::text);
  if (r->>'delta')::int >= 0 then raise exception 'perder debe bajar: %', r; end if;
  ok := rename_player(pid, tok, 'Xhavi 2');
  if not ok or rename_player(pid, repeat('c', 40), 'x') then raise exception 'rename'; end if;
  -- otro jugador sin matches no aparece
  perform register_player('Nadie', repeat('d', 40));
  insert into out select 'board', jsonb_agg(x)::text from leaderboard('rating', 10) x;
  if (select count(*) from leaderboard('rating', 10)) <> 1 then raise exception 'board'; end if;
  insert into out values ('rank', player_rank(pid)::text);
  if delete_player(pid, repeat('c', 40)) then raise exception 'delete con token ajeno'; end if;
  if (player_rank(pid)->>'rank')::int <> 1 then raise exception 'rank'; end if;
  -- lectura directa: columnas públicas sí; token_hash no; escribir no
  perform name, rating from players;
  begin perform token_hash from players; raise exception 'debió fallar: token_hash';
  exception when insufficient_privilege then null; end;
  begin update players set rating = 4000; raise exception 'debió fallar: update';
  exception when insufficient_privilege then null; end;
  begin insert into matches (player_id, played_at, mode, difficulty, outcome, score, opp_score, fuel, shots, cycles, tower, level, foul_pts, robot, team, opp_rating, rating, delta)
    values (pid, now(), 'match', 'easy', 'W', 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 0, 0); raise exception 'debió fallar: insert';
  exception when insufficient_privilege then null; end;
  begin perform * from matches; raise exception 'debió fallar: matches';
  exception when insufficient_privilege then null; end;
  ok := delete_player(pid, tok);
  if not ok then raise exception 'delete: no borró'; end if;
  if (select count(*) from leaderboard('rating', 10)) <> 0 then raise exception 'delete: sigue en el ranking'; end if;
end $$;
reset role;
select count(*) as matches_tras_borrar from matches;
select * from out;
\echo 'ranking.sql OK'
