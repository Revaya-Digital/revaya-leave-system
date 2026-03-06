function toNumber(val){
if(val === null || val === undefined) return 0;
if(typeof val === "number") return val;
if(typeof val === "string") return parseFloat(val) || 0;
if(typeof val === "object" && val.value !== undefined) return parseFloat(val.value) || 0;
return 0;
}

async function loadReports(){

Chart.getChart("trendChart")?.destroy()
Chart.getChart("typeChart")?.destroy()
Chart.getChart("utilGauge")?.destroy()  

const range = document.getElementById("rangeFilter")?.value || "month"

const fromInput = document.getElementById("reportFrom")?.value
const toInput = document.getElementById("reportTo")?.value

const today = new Date()

let startDate
let endDate = today

if(range==="month"){
startDate = new Date(today.getFullYear(),today.getMonth(),1)
}

if(range==="year"){
startDate = new Date(today.getFullYear(),0,1)
}

if(range==="custom" && fromInput && toInput){
startDate = new Date(fromInput)
endDate = new Date(toInput)
}

if(!startDate){
startDate = new Date(2026,0,1)
}

const { data: leaves } = await db
.from("leave_requests")
.select("*")

const { data: employees } = await db
.from("employees")
.select("auth_user_id,name")

const { data: types } = await db
.from("leave_types")
.select("id,name,yearly_quota")

if(!leaves) return

/* FILTER BY DATE */

const filtered = leaves.filter(l=>{

const d = new Date(l.start_date)

return d >= startDate && d <= endDate

})

/* STATS */

let totalDays = 0
let approvedDays = 0
let rejected = 0
let unpaid = 0

filtered.forEach(l=>{

totalDays += l.days || 0

if(l.status==="approved") approvedDays += l.days || 0
if(l.status==="rejected") rejected += 1
if(l.is_pto===false) unpaid += l.days || 0

})

const statsContainer = document.getElementById("statsCards");

if(!statsContainer) return;

statsContainer.innerHTML = `
<div class="stat-card">
<span>Total Days</span>
<h2>${totalDays}</h2>
</div>

<div class="stat-card">
<span>Approved Days</span>
<h2>${approvedDays}</h2>
</div>

<div class="stat-card">
<span>Rejected Requests</span>
<h2>${rejected}</h2>
</div>

<div class="stat-card">
<span>Unpaid Days</span>
<h2>${unpaid}</h2>
</div>
`

/* TYPE USAGE */

const typeUsage = {}

filtered.forEach(l=>{

if(l.status==="approved"){

if(!typeUsage[l.type_id]) typeUsage[l.type_id]=0

typeUsage[l.type_id]+=l.days || 0

}

})

const typeNames=[]
const typeValues=[]

types.forEach(t=>{

typeNames.push(t.name)
typeValues.push(typeUsage[t.id] || 0)

})

renderTypeChart(typeValues,typeNames)

/* UTILIZATION */

const totalQuota = types.reduce((sum,t)=>sum+Number(t.yearly_quota),0)
const usedQuota = approvedDays

renderUtilGauge(usedQuota,totalQuota)

/* TREND */

const monthly = new Array(12).fill(0)

filtered.forEach(l=>{

if(l.status==="approved"){

const d = new Date(l.start_date)

monthly[d.getMonth()] += l.days || 0

}

})

new Chart(document.getElementById("trendChart"),{

type:"line",

data:{
labels:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
datasets:[{
label:"Leave Days",
data:monthly,
tension:0.3
}]
}

})

/* HEATMAP */

renderHeatmap(filtered)

/* TOP EMPLOYEES */

const empUsage={}

filtered.forEach(l=>{

if(l.status==="approved"){

if(!empUsage[l.employee_id]) empUsage[l.employee_id]=0

empUsage[l.employee_id]+=l.days || 0

}

})

const ranking = Object.entries(empUsage)
.map(([id,days])=>({id,days}))
.sort((a,b)=>b.days-a.days)

const empBody = document.querySelector("#empReport tbody")

empBody.innerHTML=""

ranking.forEach((r,i)=>{

const name = employees.find(e=>e.auth_user_id===r.id)?.name || "Unknown"

let level="Normal"

if(r.days>20) level="High"
else if(r.days>10) level="Medium"

empBody.innerHTML+=`

<tr>
<td>#${i+1} ${name}</td>
<td>${r.days}</td>
<td>${level}</td>
</tr>

`

})

}

function exportCSV(){

const rows = document.querySelectorAll("#typeReport tr");

let csv=[];

rows.forEach(row=>{

const cols = row.querySelectorAll("td,th");

let data=[];

cols.forEach(c=>data.push(c.innerText));

csv.push(data.join(","));

});

const blob = new Blob([csv.join("\n")],{type:"text/csv"});

const a=document.createElement("a");

a.href=URL.createObjectURL(blob);

a.download="leave-report.csv";

a.click();

}

function renderHeatmap(leaves){

const map = {};

leaves.forEach(l=>{

const d = l.start_date;

if(!map[d]) map[d]=0;

map[d]+=l.days || 1;

});

const container = document.getElementById("leaveHeatmap");

container.innerHTML="";

Object.keys(map).forEach(date=>{

let level="level-1";

if(map[date]>3) level="level-2";
if(map[date]>6) level="level-3";
if(map[date]>10) level="level-4";

container.innerHTML += `
<div class="heat-cell ${level}" title="${map[date]} leave requests on ${date}"></div>
`;

});

}

function renderTypeChart(typeUsage,typeNames){

new Chart(document.getElementById("typeChart"),{

type:"pie",

data:{
labels:typeNames,
datasets:[{
data:typeUsage,
backgroundColor:[
"#2563eb",
"#10b981",
"#f59e0b",
"#ef4444",
"#6366f1"
]
}]
}

});

}

function renderUtilGauge(used,total){

const percent = Math.round((used/total)*100);

new Chart(document.getElementById("utilGauge"),{

type:"doughnut",

data:{
labels:["Used","Remaining"],
datasets:[{
data:[used,total-used],
backgroundColor:["#2563eb","#e5e7eb"]
}]
},

options:{
plugins:{
title:{
display:true,
text:"Leave Utilization "+percent+"%"
}
},
cutout:"70%"
}

});

}

window.addEventListener("DOMContentLoaded",loadReports);
