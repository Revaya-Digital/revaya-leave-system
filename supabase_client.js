const SUPABASE_URL = "https://shecktyeqaqojhotysff.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoZWNrdHllcWFxb2pob3R5c2ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1OTg5NzYsImV4cCI6MjA4NzE3NDk3Nn0.r2xk0aevwGlL5HUCsCmF9_9ByNXsf8MXDvW61-bgX4I";
const GOOGLE_SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxAfyB1_CAefALSgyZzSdO60wOlJ7sz5rHV6WQ4XC5NxaICBJm0iUw3yRSTaqs8VmiL/exec";

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.db = client;

async function getAuthHeaders(){

const { data, error } = await db.auth.getSession();

if(error || !data.session?.access_token){
throw new Error("User session not found");
}

return {
"Content-Type": "application/json",
"Authorization": "Bearer " + data.session.access_token,
"apikey": SUPABASE_ANON_KEY
};

}

async function logLeaveToSheet(record){

const body = new URLSearchParams();

Object.entries(record).forEach(([key, value]) => {
body.append(key, value == null ? "" : String(value));
});

await fetch(GOOGLE_SHEET_WEBHOOK_URL,{
method:"POST",
mode:"no-cors",
headers:{
"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"
},
body: body.toString()
});

}

function showToast(message,type="info"){

const container = document.getElementById("toastContainer");

const toast = document.createElement("div");
toast.className = "toast toast-"+type;
toast.innerText = message;

container.appendChild(toast);

setTimeout(()=>{
toast.style.opacity="0";
toast.style.transform="translateY(-10px)";
setTimeout(()=>toast.remove(),300);
},3000);
}

function showLoader(text = "Processing..."){
  const loader = document.getElementById("globalLoader");
  const msg = document.getElementById("loaderText");

  if(loader){
    loader.classList.add("active");
  }

  if(msg){
    msg.innerText = text;
  }
}

function hideLoader(){
  const loader = document.getElementById("globalLoader");
  if(loader){
    loader.classList.remove("active");
  }
}