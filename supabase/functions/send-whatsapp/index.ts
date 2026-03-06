import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
