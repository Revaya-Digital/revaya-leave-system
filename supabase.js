const SUPABASE_URL = "https://shecktyeqaqojhotysff.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoZWNrdHllcWFxb2pob3R5c2ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1OTg5NzYsImV4cCI6MjA4NzE3NDk3Nn0.r2xk0aevwGlL5HUCsCmF9_9ByNXsf8MXDvW61-bgX4I";

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.db = client;

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
