import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

/* ✅ CORS HEADERS */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

serve(async (req) => {

  /* ✅ HANDLE PREFLIGHT */
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {

    console.log("🚀 FUNCTION STARTED")

    const bodyText = await req.text()
    console.log("📦 RAW BODY:", bodyText)

    const body = JSON.parse(bodyText)
    console.log("📦 PARSED BODY:", body)

    const { leave_request_id } = body

    if (!leave_request_id) {
      console.log("❌ NO ID RECEIVED")
      return new Response("Missing ID", { status: 400, headers: corsHeaders })
    }

    /* ✅ SUPABASE CLIENT */
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    console.log("🔗 FETCHING LEAVE")

    /* 🔹 GET LEAVE */
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select("*,leave_types (name)")
      .eq("id", leave_request_id)
      .single()

    console.log("📄 LEAVE:", leave)

    if (leaveError || !leave) {
      return new Response("Leave not found", {
        status: 404,
        headers: corsHeaders
      })
    }

    /* 🔹 GET EMPLOYEE */
    const { data: emp, error: empError } = await supabase
      .from("employees")
      .select("name,email,phone")
      .eq("auth_user_id", leave.employee_id)
      .single()

    console.log("👤 EMP:", emp)

    /* 🔹 GET ADMIN */
    const { data: admins, error: adminError } = await supabase
      .from("employees")
      .select("email")
      .eq("role", "admin")

    console.log("👑 ADMINS:", admins)

    const adminEmail = admins?.[0]?.email

    if(!adminEmail){
      console.log("❌ No admin email found")
      return new Response("No admin found", {
        status: 400,
        headers: corsHeaders
      })
    }

    /* 🔹 SEND EMAIL */
    console.log("📧 CALLING SEND EMAIL")

    const emailRes = await fetch("https://shecktyeqaqojhotysff.supabase.co/functions/v1/send-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": Deno.env.get("INTERNAL_SECRET")!
      },
      body: JSON.stringify({
        to: adminEmail,
        subject: "New Leave Request",
        message: `${emp?.name} applied leave from ${leave.start_date} to ${leave.end_date}`
      })
    })

    console.log("📧 EMAIL STATUS:", emailRes.status)

    /* 🔹 GOOGLE SHEET LOG */
    const sheetUrl = Deno.env.get("GOOGLE_SHEET_WEBHOOK_URL")

    console.log("📊 SHEET URL:", sheetUrl)

    const sheetRes = await fetch(Deno.env.get("GOOGLE_SHEET_WEBHOOK_URL")!, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        leave_id: leave.id || "",
        name: emp?.name || "",
        phone: emp?.phone || "",
        leave_type: leave.leave_types?.name || "",
        days: String(leave.days || ""),
        from_date: leave.start_date,
        to_date: leave.end_date,
        is_PTO: leave.is_pto ? "Paid" : "Unpaid",
        is_half_day: leave.is_half_day ? "YES" : "NO",
        half_day_session: leave.half_day_session ? leave.half_day_session : "N/A",
        status: "pending"
      })
    })

    console.log("📊 SHEET STATUS:", sheetRes.status)

    /* ✅ SUCCESS */
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    })

  } catch (err) {
    console.error(err)

    return new Response("Server Error", {
      status: 500,
      headers: corsHeaders
    })
  }
})