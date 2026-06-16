import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function generateNextVerificationTime() {
  const min = 35;
  const max = 95;
  const randomMinutes = Math.floor(Math.random() * (max - min + 1)) + min;
  const next = new Date();

  next.setMinutes(next.getMinutes() + randomMinutes);

  return next.toISOString();
}

serve(async () => {

  try {

    const now = new Date();

    /*
      ==========================================
      PART 1
      PROCESS EXPIRED VERIFICATIONS
      ==========================================
    */

    const { data: expiredVerifications } = await supabase
      .from("activity_verifications")
      .select("*")
      .eq("verification_status", "pending")
      .lte("expires_at", now.toISOString());

    for (const verification of expiredVerifications || []) {

      const { data: taskLog } = await supabase
        .from("task_logs")
        .select("*")
        .eq("id", verification.task_log_id)
        .is("end_time", null)
        .single();

      if (taskLog) {

        const startTime = new Date(taskLog.start_time);

        const duration = Math.floor(
          (now.getTime() - startTime.getTime()) / 1000
        );

        await supabase
          .from("task_logs")
          .update({
            end_time: now.toISOString(),
            duration,
            stop_reason: "verification_timeout",
            verification_id: verification.id
          })
          .eq("id", taskLog.id);

      }

      await supabase
        .from("tasks")
        .update({
          status: "pending",
          next_verification_at: null
        })
        .eq("id", verification.task_id);

      await supabase
        .from("activity_verifications")
        .update({
          verification_status: "expired",
          response_type: "no_response",
          responded_at: now.toISOString()
        })
        .eq("id", verification.id);

      const { data: employee } = await supabase
      .from("employees")
      .select("verification_breaches")
      .eq("id", verification.employee_id)
      .single();

      await supabase
      .from("employees")
      .update({
        verification_breaches: (employee?.verification_breaches || 0) + 1
      })
      .eq("id", verification.employee_id);

      await supabase
        .from("notifications")
        .insert({
          employee_id: verification.employee_id,
          title: "Activity Verification Failed",
          message:
            "Task tracking was stopped because no response was received.",
          notification_type: "activity_verification",
          entity_type: "task",
          entity_id: verification.task_id
        });
    }

    /*
      ==========================================
      PART 2
      GENERATE NEW VERIFICATIONS
      ==========================================
    */

    const { data: activeLogs } = await supabase
      .from("task_logs")
      .select(`
        *,
        tasks!inner(
          id,
          status,
          next_verification_at
        ),
        employees!inner(
          id,
          last_seen_at
        )
      `)
      .is("end_time", null);

    for (const log of activeLogs || []) {

      const task = log.tasks;
      const employee = log.employees;

      if (
        !task?.next_verification_at ||
        task.status !== "in_progress"
      ) {
        continue;
      }

      const verificationTime =
        new Date(task.next_verification_at);

      if (verificationTime > now) {
        continue;
      }

      const { data: existingPending } = await supabase
        .from("activity_verifications")
        .select("id")
        .eq("employee_id", employee.id)
        .eq("verification_status", "pending")
        .maybeSingle();

      if (existingPending) {
        continue;
      }

      let isAvailable = false;

      if (employee.last_seen_at) {

        const lastSeen =
          new Date(employee.last_seen_at);

        const diffMinutes =
          (now.getTime() - lastSeen.getTime()) / 60000;

        isAvailable = diffMinutes <= 2;
      }

      if (isAvailable) {

        await supabase
          .from("activity_verifications")
          .insert({
            employee_id: employee.id,
            task_id: task.id,
            task_log_id: log.id,
            verification_status: "pending",
            expires_at: new Date(
              now.getTime() + (60 * 1000)
            ).toISOString()
          });

        await supabase
          .from("tasks")
          .update({
            next_verification_at: null
          })
          .eq("id", task.id);

      } else {

        await supabase
          .from("activity_verifications")
          .insert({
            employee_id: employee.id,
            task_id: task.id,
            task_log_id: log.id,
            verification_status: "unverified"
          });

        await supabase
          .from("tasks")
          .update({
            next_verification_at:
              generateNextVerificationTime()
          })
          .eq("id", task.id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true
      }),
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  } catch (err) {

    console.error(err);

    return new Response(
      JSON.stringify({
        success: false,
        error: String(err)
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
});