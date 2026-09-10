begin;

select plan(8);

select has_table('public', 'player_course_tee_preferences', 'tee preferences table exists');
select has_table('public', 'round_course_handicap_snapshots', 'course handicap snapshots table exists');
select row_security_active('public.player_course_tee_preferences', 'tee preferences has RLS');
select row_security_active('public.round_course_handicap_snapshots', 'course handicap snapshots has RLS');
select policy_cmd_is('public', 'player_course_tee_preferences', 'tee preferences select own', 'SELECT', 'tee preference SELECT is separate');
select policy_cmd_is('public', 'player_course_tee_preferences', 'tee preferences update own', 'UPDATE', 'tee preference UPDATE is separate');
select policy_cmd_is('public', 'round_course_handicap_snapshots', 'course handicap snapshots select own', 'SELECT', 'snapshot SELECT is owner-only');
select policy_cmd_is('public', 'round_course_handicap_snapshots', 'course handicap snapshots insert own', 'INSERT', 'snapshot INSERT is owner-only');

select * from finish();
rollback;
