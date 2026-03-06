create table public.leave_types (
  id uuid not null default gen_random_uuid (),
  name text not null,
  yearly_quota integer not null,
  created_at timestamp without time zone null default now(),
  constraint leave_types_pkey primary key (id),
  constraint leave_types_name_key unique (name),
  constraint leave_types_yearly_quota_check check ((yearly_quota >= 0))
) TABLESPACE pg_default;

create table public.employees (
  id uuid not null default gen_random_uuid (),
  name text null,
  email text null,
  role text null,
  created_at timestamp without time zone null default now(),
  auth_user_id uuid null,
  constraint employees_pkey primary key (id),
  constraint employees_auth_user_id_key unique (auth_user_id),
  constraint employees_email_key unique (email)
) TABLESPACE pg_default;

create table public.leave_requests (
  id uuid not null default gen_random_uuid (),
  employee_id uuid null,
  type_id uuid not null,
  start_date date not null,
  end_date date not null,
  days integer null default 0,
  status text not null default 'pending'::text,
  editable boolean null default true,
  admin_comment text null,
  created_at timestamp without time zone null default now(),
  constraint leave_requests_pkey primary key (id),
  constraint leave_requests_employee_id_fkey foreign KEY (employee_id) references auth.users (id) on delete CASCADE,
  constraint leave_requests_type_id_fkey foreign KEY (type_id) references leave_types (id),
  constraint leave_requests_status_check check (
    (
      status = any (
        array[
          'pending'::text,
          'approved'::text,
          'rejected'::text
        ]
      )
    )
  ),
  constraint valid_dates check ((end_date >= start_date))
) TABLESPACE pg_default;

create trigger leave_days_trigger BEFORE INSERT
or
update OF start_date,
end_date on leave_requests for EACH row
execute FUNCTION calculate_leave_days ();

create trigger lock_trigger BEFORE
update OF status on leave_requests for EACH row
execute FUNCTION lock_after_action ();

create trigger quota_check_trigger BEFORE INSERT on leave_requests for EACH row
execute FUNCTION check_leave_quota ();

create trigger set_employee_trigger BEFORE INSERT on leave_requests for EACH row
execute FUNCTION set_employee_from_auth ();

-- Policies in JSON Format
[
  {
    "tablename": "employees",
    "policyname": "employee can view own profile",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "SELECT",
    "qual": "((auth_user_id = auth.uid()) OR is_admin())",
    "with_check": null
  },
  {
    "tablename": "employees",
    "policyname": "employees read self",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "SELECT",
    "qual": "(auth_user_id = auth.uid())",
    "with_check": null
  },
  {
    "tablename": "leave_requests",
    "policyname": "admin delete",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "DELETE",
    "qual": "is_admin()",
    "with_check": null
  },
  {
    "tablename": "leave_requests",
    "policyname": "admin update",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "UPDATE",
    "qual": "is_admin()",
    "with_check": null
  },
  {
    "tablename": "leave_requests",
    "policyname": "delete pending leave",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "DELETE",
    "qual": "(is_admin() OR ((status = 'pending'::text) AND (employee_id IN ( SELECT employees.id\n   FROM employees\n  WHERE (employees.auth_user_id = auth.uid())))))",
    "with_check": null
  },
  {
    "tablename": "leave_requests",
    "policyname": "employee create own leave",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "INSERT",
    "qual": null,
    "with_check": "(employee_id IN ( SELECT employees.id\n   FROM employees\n  WHERE (employees.auth_user_id = auth.uid())))"
  },
  {
    "tablename": "leave_requests",
    "policyname": "employee insert own",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "INSERT",
    "qual": null,
    "with_check": "(employee_id = ( SELECT employees.id\n   FROM employees\n  WHERE (employees.auth_user_id = auth.uid())))"
  },
  {
    "tablename": "leave_requests",
    "policyname": "insert own",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "INSERT",
    "qual": null,
    "with_check": "(employee_id = auth.uid())"
  },
  {
    "tablename": "leave_requests",
    "policyname": "read own or admin",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "SELECT",
    "qual": "(is_admin() OR (employee_id = auth.uid()))",
    "with_check": null
  },
  {
    "tablename": "leave_requests",
    "policyname": "update leave request",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "UPDATE",
    "qual": "(is_admin() OR ((editable = true) AND (status = 'pending'::text) AND (employee_id IN ( SELECT employees.id\n   FROM employees\n  WHERE (employees.auth_user_id = auth.uid())))))",
    "with_check": null
  },
  {
    "tablename": "leave_requests",
    "policyname": "view leave requests",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "SELECT",
    "qual": "((employee_id IN ( SELECT employees.id\n   FROM employees\n  WHERE (employees.auth_user_id = auth.uid()))) OR is_admin())",
    "with_check": null
  },
  {
    "tablename": "leave_types",
    "policyname": "everyone can read leave types",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "SELECT",
    "qual": "true",
    "with_check": null
  },
  {
    "tablename": "leave_types",
    "policyname": "read leave types",
    "permissive": "PERMISSIVE",
    "roles": "{public}",
    "cmd": "SELECT",
    "qual": "true",
    "with_check": null
  }
]


-- Routines in JSON Format
[
  {
    "routine_name": "calculate_leave_days",
    "routine_definition": "\r\nbegin\r\n  new.days := (new.end_date - new.start_date) + 1;\r\n  return new;\r\nend;\r\n"
  },
  {
    "routine_name": "check_leave_quota",
    "routine_definition": "\r\ndeclare\r\n  used_days int;\r\n  allowed_days int;\r\nbegin\r\n\r\n  select yearly_quota into allowed_days\r\n  from public.leave_types\r\n  where id = new.type_id;\r\n\r\n  select coalesce(sum(days),0)\r\n  into used_days\r\n  from public.leave_requests\r\n  where employee_id = new.employee_id\r\n  and type_id = new.type_id\r\n  and status = 'approved'\r\n  and date_part('year', start_date) = date_part('year', new.start_date);\r\n\r\n  if used_days + new.days > allowed_days then\r\n    raise exception 'Leave quota exceeded';\r\n  end if;\r\n\r\n  return new;\r\nend;\r\n"
  },
  {
    "routine_name": "lock_after_action",
    "routine_definition": "\r\nbegin\r\n  if old.status = 'pending' and new.status <> 'pending' then\r\n    new.editable := false;\r\n  end if;\r\n  return new;\r\nend;\r\n"
  },
  {
    "routine_name": "handle_new_user",
    "routine_definition": "\r\nbegin\r\n  insert into public.employees (auth_user_id, email, name, role)\r\n  values (new.id, new.email, new.raw_user_meta_data->>'name', 'employee');\r\n  return new;\r\nend;\r\n"
  },
  {
    "routine_name": "set_employee_from_auth",
    "routine_definition": "\r\nbegin\r\n\r\n  if new.employee_id is null then\r\n    select id into new.employee_id\r\n    from public.employees\r\n    where auth_user_id = auth.uid();\r\n  end if;\r\n\r\n  return new;\r\nend;\r\n"
  },
  {
    "routine_name": "is_admin",
    "routine_definition": "\r\n  select auth.jwt()->>'email' in (\r\n    'adam.kamani@revaya.digital'\r\n  );\r\n"
  }
]