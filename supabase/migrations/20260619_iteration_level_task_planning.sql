-- Iteration-level task planning and performance tracking.
-- Run this migration before deploying the matching frontend files.

alter table public.task_iterations
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists allotted_hours numeric not null default 0,
  add column if not exists deadline date,
  add column if not exists revision_count integer not null default 0,
  add column if not exists started_at timestamptz,
  add column if not exists approved_at timestamptz;

alter table public.task_logs
  add column if not exists revision_no integer not null default 0;

update public.task_iterations
set title = coalesce(nullif(title, ''), 'Iteration ' || iteration_no)
where title is null or title = '';

alter table public.task_iterations
  alter column title set not null,
  alter column status set default 'planned';

alter table public.task_iterations
  drop constraint if exists task_iterations_status_check;
alter table public.task_iterations
  add constraint task_iterations_status_check check (
    status in ('planned', 'working', 'in_progress', 'submitted', 'revision_requested', 'approved')
  );

-- Existing installations used a newly-created iteration as a revision attempt.
-- Keep that data intact. New revisions are recorded below against the same
-- planned iteration and no longer create another task_iterations row.
create table if not exists public.task_iteration_revisions (
  id uuid primary key default gen_random_uuid(),
  iteration_id uuid not null references public.task_iterations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  revision_no integer not null,
  reason text not null,
  requested_by uuid references public.employees(id),
  requested_at timestamptz not null default now(),
  resubmitted_at timestamptz,
  resolved_at timestamptz,
  constraint task_iteration_revisions_number_unique unique(iteration_id, revision_no)
);

create index if not exists task_iterations_task_sequence_idx
  on public.task_iterations(task_id, iteration_no);
create index if not exists task_iteration_revisions_iteration_idx
  on public.task_iteration_revisions(iteration_id, requested_at);

create or replace view public.task_iteration_performance as
select
  i.id as iteration_id,
  i.task_id,
  i.iteration_no,
  i.title,
  i.status,
  i.allotted_hours,
  i.deadline,
  i.submitted_at,
  i.approved_at,
  i.revision_count,
  coalesce(sum(l.duration), 0)::bigint as tracked_seconds,
  case
    when i.submitted_at is null or i.deadline is null then null
    else i.submitted_at::date <= i.deadline
  end as submitted_on_time
from public.task_iterations i
left join public.task_logs l on l.iteration_id = i.id
group by i.id;

create or replace view public.task_performance_summary as
select
  t.id as task_id,
  count(i.id)::integer as total_iterations,
  count(i.id) filter (where i.status = 'approved')::integer as completed_iterations,
  coalesce(sum(i.allotted_hours), 0) as allocated_hours,
  coalesce(sum(p.tracked_seconds), 0)::bigint as tracked_seconds,
  count(i.id) filter (where p.submitted_on_time is true)::integer as on_time_iterations,
  count(i.id) filter (where p.submitted_on_time is false)::integer as breached_iterations,
  coalesce(sum(i.revision_count), 0)::integer as total_revisions,
  max(i.deadline) as final_deadline
from public.tasks t
left join public.task_iterations i on i.task_id = t.id
left join public.task_iteration_performance p on p.iteration_id = i.id
group by t.id;

-- Preserve old task-level consumers while making iterations the source of truth.
create or replace function public.sync_task_iteration_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_task_id uuid := coalesce(new.task_id, old.task_id);
begin
  update public.tasks t
  set allotted_hours = s.total_hours,
      deadline = s.final_deadline
  from (
    select
      coalesce(sum(allotted_hours), 0) as total_hours,
      max(deadline) as final_deadline
    from public.task_iterations
    where task_id = affected_task_id
  ) s
  where t.id = affected_task_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_task_iteration_totals_trigger on public.task_iterations;
create trigger sync_task_iteration_totals_trigger
after insert or delete or update of allotted_hours, deadline
on public.task_iterations
for each row execute function public.sync_task_iteration_totals();
