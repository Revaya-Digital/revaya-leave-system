import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {

/* CORS preflight */
if (req.method === "OPTIONS") {
return new Response("ok", {
headers: {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS"
}
});
}

const { to, subject, message } = await req.json();

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const response = await fetch("https://api.resend.com/emails", {
method: "POST",
headers: {
"Content-Type": "application/json",
"Authorization": `Bearer ${RESEND_API_KEY}`,
},
body: JSON.stringify({
from: "Leave System <adam.kamanig@revaya.digital>",
to: [to],
subject: subject,
html: `<p>${message}</p>`,
}),
});

const data = await response.json();

console.log("RESEND RESPONSE:", data);

return new Response(JSON.stringify(data), {
status: response.status,
headers: {
"Content-Type": "application/json",
"Access-Control-Allow-Origin": "*"
}
});
});
