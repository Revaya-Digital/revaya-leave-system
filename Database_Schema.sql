-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.clients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  company_name text,
  email text,
  phone text,
  address text,
  notes text,
  status text DEFAULT 'active'::text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT clients_pkey PRIMARY KEY (id),
  CONSTRAINT clients_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.employees(id)
);
CREATE TABLE public.employee_bank_details (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_title text,
  bank_name text,
  account_number text,
  iban text,
  is_active boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT now(),
  employee_id uuid,
  CONSTRAINT employee_bank_details_pkey PRIMARY KEY (id),
  CONSTRAINT employee_bank_details_employee_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id)
);
CREATE TABLE public.employee_salaries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  basic_salary numeric,
  home_allowance numeric,
  travel_allowance numeric,
  mobile_allowance numeric,
  commission numeric,
  effective_date date,
  created_at timestamp without time zone DEFAULT now(),
  employee_id uuid,
  CONSTRAINT employee_salaries_pkey PRIMARY KEY (id),
  CONSTRAINT employee_salaries_employee_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id)
);
CREATE TABLE public.employee_tax_tracker (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  year integer NOT NULL,
  estimated_annual_income numeric NOT NULL,
  annual_tax numeric NOT NULL,
  tax_paid_to_date numeric DEFAULT 0,
  remaining_tax numeric NOT NULL,
  last_updated timestamp without time zone DEFAULT now(),
  created_at timestamp without time zone DEFAULT now(),
  employee_id uuid,
  CONSTRAINT employee_tax_tracker_pkey PRIMARY KEY (id),
  CONSTRAINT employee_tax_tracker_employee_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id)
);
CREATE TABLE public.employees (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text,
  email text UNIQUE,
  created_at timestamp without time zone DEFAULT now(),
  auth_user_id uuid UNIQUE,
  phone text,
  cnic text,
  address text,
  joining_date date,
  job_title text,
  department text,
  status text DEFAULT 'active'::text,
  resignation_date date,
  role_id uuid,
  manager_id uuid,
  is_admin boolean DEFAULT false,
  CONSTRAINT employees_pkey PRIMARY KEY (id),
  CONSTRAINT employees_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id)
);
CREATE TABLE public.holidays (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  holiday_date date NOT NULL UNIQUE,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT holidays_pkey PRIMARY KEY (id)
);
CREATE TABLE public.invoice_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  quantity numeric DEFAULT 1,
  unit_price numeric DEFAULT 0,
  total_price numeric DEFAULT 0,
  CONSTRAINT invoice_items_pkey PRIMARY KEY (id),
  CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id)
);
CREATE TABLE public.invoice_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  amount numeric NOT NULL,
  payment_method text,
  notes text,
  payment_date date DEFAULT CURRENT_DATE,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT invoice_payments_pkey PRIMARY KEY (id),
  CONSTRAINT invoice_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id),
  CONSTRAINT invoice_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.employees(id)
);
CREATE TABLE public.invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  project_id uuid,
  invoice_number text NOT NULL UNIQUE,
  invoice_title text,
  description text,
  invoice_type text DEFAULT 'one_time'::text,
  status text DEFAULT 'unpaid'::text,
  invoice_date date NOT NULL,
  due_date date,
  currency text DEFAULT 'PKR'::text,
  subtotal numeric DEFAULT 0,
  tax_amount numeric DEFAULT 0,
  discount_amount numeric DEFAULT 0,
  total_amount numeric DEFAULT 0,
  paid_amount numeric DEFAULT 0,
  remaining_amount numeric DEFAULT 0,
  is_recurring boolean DEFAULT false,
  recurring_cycle text,
  next_recurring_date date,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT invoices_pkey PRIMARY KEY (id),
  CONSTRAINT invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id),
  CONSTRAINT invoices_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.employees(id)
);
CREATE TABLE public.leave_audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  leave_id uuid,
  action text,
  performed_by uuid,
  old_status text,
  new_status text,
  comment text,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT leave_audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT leave_audit_logs_leave_id_fkey FOREIGN KEY (leave_id) REFERENCES public.leave_requests(id),
  CONSTRAINT leave_audit_logs_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES auth.users(id)
);
CREATE TABLE public.leave_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type_id uuid NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  days integer DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancel_requested'::text, 'cancelled'::text])),
  editable boolean DEFAULT true,
  admin_comment text,
  created_at timestamp without time zone DEFAULT now(),
  is_pto boolean DEFAULT true,
  is_half_day boolean DEFAULT false,
  half_day_session text,
  employee_id uuid,
  CONSTRAINT leave_requests_pkey PRIMARY KEY (id),
  CONSTRAINT leave_requests_type_id_fkey FOREIGN KEY (type_id) REFERENCES public.leave_types(id),
  CONSTRAINT leave_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id)
);
CREATE TABLE public.leave_types (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  yearly_quota integer NOT NULL CHECK (yearly_quota >= 0),
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT leave_types_pkey PRIMARY KEY (id)
);
CREATE TABLE public.payroll (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  period_start date,
  period_end date,
  basic_salary numeric,
  home_allowance numeric,
  unpaid_leaves integer DEFAULT 0,
  deduction numeric DEFAULT 0,
  gross_salary numeric,
  payment_status text DEFAULT 'pending'::text,
  payment_date date,
  payment_proof text,
  created_at timestamp without time zone DEFAULT now(),
  payroll_month text,
  travel_allowance numeric DEFAULT '0'::numeric,
  mobile_allowance numeric DEFAULT '0'::numeric,
  commission numeric DEFAULT '0'::numeric,
  worked_days integer,
  annual_income_estimate numeric,
  tax_amount numeric,
  net_salary numeric,
  tax_year integer,
  tax_snapshot jsonb,
  annual_tax numeric,
  employee_id uuid,
  CONSTRAINT payroll_pkey PRIMARY KEY (id),
  CONSTRAINT payroll_employee_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id)
);
CREATE TABLE public.payroll_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cycle_start_day integer,
  cycle_end_day integer,
  salary_disbursement_day integer,
  effective_from date,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT payroll_settings_pkey PRIMARY KEY (id)
);
CREATE TABLE public.projects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_by uuid,
  status text DEFAULT 'active'::text,
  created_at timestamp without time zone DEFAULT now(),
  client_id uuid,
  CONSTRAINT projects_pkey PRIMARY KEY (id),
  CONSTRAINT projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.employees(id),
  CONSTRAINT projects_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id)
);
CREATE TABLE public.reimbursements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  amount numeric NOT NULL,
  category text,
  description text,
  receipt_url text,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  admin_comment text,
  created_at timestamp with time zone DEFAULT now(),
  employee_id uuid,
  CONSTRAINT reimbursements_pkey PRIMARY KEY (id),
  CONSTRAINT reimbursements_employee_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id)
);
CREATE TABLE public.roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  permissions jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT roles_pkey PRIMARY KEY (id)
);
CREATE TABLE public.task_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid,
  employee_id uuid,
  start_time timestamp with time zone NOT NULL,
  end_time timestamp with time zone,
  duration integer,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT task_logs_pkey PRIMARY KEY (id),
  CONSTRAINT task_logs_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id),
  CONSTRAINT task_logs_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id)
);
CREATE TABLE public.tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid,
  title text NOT NULL,
  description text,
  assigned_to uuid NOT NULL,
  assigned_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'review'::text, 'submitted'::text, 'closed'::text])),
  deadline date,
  allotted_hours integer DEFAULT 0,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.employees(id),
  CONSTRAINT tasks_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.employees(id)
);
CREATE TABLE public.tax_slabs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  min_income numeric NOT NULL,
  max_income numeric,
  tax_rate numeric NOT NULL,
  effective_from date NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  effective_to date DEFAULT '2999-12-31'::date,
  CONSTRAINT tax_slabs_pkey PRIMARY KEY (id)
);