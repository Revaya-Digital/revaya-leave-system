import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {

if (req.method === "OPTIONS") {
return new Response("ok", {
headers: {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS"
}
});
}

const authHeader = req.headers.get("Authorization");

if (!authHeader?.startsWith("Bearer ")) {
return new Response(JSON.stringify({ error: "Missing bearer token" }), {
status: 401,
headers: {
"Content-Type": "application/json",
"Access-Control-Allow-Origin": "*"
}
});
}

const supabase = createClient(
Deno.env.get("SUPABASE_URL") ?? "",
Deno.env.get("SUPABASE_ANON_KEY") ?? "",
{
global: {
headers: {
Authorization: authHeader
}
}
}
);

const { data: authData, error: authError } = await supabase.auth.getUser();

if (authError || !authData.user) {
return new Response(JSON.stringify({ error: "Unauthorized" }), {
status: 401,
headers: {
"Content-Type": "application/json",
"Access-Control-Allow-Origin": "*"
}
});
}

const { phone, message } = await req.json();

const SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const FROM = Deno.env.get("TWILIO_WHATSAPP_NUMBER");

const auth = btoa(`${SID}:${TOKEN}`);

const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
method: "POST",
headers: {
"Authorization": `Basic ${auth}`,
"Content-Type": "application/x-www-form-urlencoded"
},
body: new URLSearchParams({
From: FROM,
To: `whatsapp:${phone}`,
Body: message
})
});

const data = await res.text();

return new Response(data, {
headers: {
"Access-Control-Allow-Origin": "*"
}
});
});
