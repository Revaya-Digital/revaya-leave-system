const analyticsFilters = {
  range:"30days",
  employee:null,
  department:null,
  project:null,
  status:null
};

    function formatDuration(seconds){
        seconds = Number(seconds || 0);
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        let result = "";

        if(hrs > 0){
            result += `${hrs}h `;
        }

        if(mins > 0){
            result += `${mins}m `;
        }

        if(secs > 0){
            result += `${secs}s`;
        }

        return result.trim() || "0s";
    }

    function getAnalyticsDateRange(){
        const today = new Date();
        let startDate = new Date();
        switch(analyticsFilters.range){
            case "7days":
            startDate.setDate(today.getDate() - 7);
            break;
            case "15days":
            startDate.setDate(today.getDate() - 15);
            break;
            case "30days":
            startDate.setDate(today.getDate() - 30);
            break;
            case "month":
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
            case "quarter":
            const quarter = Math.floor(today.getMonth()/3);
            startDate = new Date(today.getFullYear(), quarter * 3, 1);
            break;
            case "year":
            startDate = new Date(today.getFullYear(), 0, 1);
            break;
            default:
            startDate.setDate(today.getDate() - 30);
        }

        return {
            startDate,
            endDate: today
        };
    }

    async function loadExecutiveAnalytics(){
        showLoader("Loading analytics...");
        const {startDate, endDate} = getAnalyticsDateRange();

        const { data: tasks } = await db
        .from("tasks")
        .select("*");

        const { data: projects } = await db
        .from("projects")
        .select("*");

        const { data: employees } = await db
        .from("employees")
        .select("*");

        const departments = [...new Set(employees.map(e => e.department).filter(Boolean))];
        const departmentOptions = departments.map(dept => `<option value="${dept}"${analyticsFilters.department === dept ? "selected" : ""}> ${dept} </option>`).join("");
        const employeeOptions = employees.map(emp => `<option value="${emp.id}"${String(analyticsFilters.employee) === String(emp.id) ? "selected" : ""}> ${emp.name} </option>`).join("");

        const { data: taskLogs } = await db
        .from("task_logs")
        .select("*");

        let filteredTasks = [...tasks];

        filteredTasks = filteredTasks.filter(t => {
            if(!t.created_at){
                return true;
            }

            const created = new Date(t.created_at);
            return (created >= startDate && created <= endDate);
            });

        if(analyticsFilters.employee){
            filteredTasks = filteredTasks.filter(t => String(t.assigned_to) === String(analyticsFilters.employee));
        }

        if(analyticsFilters.department){
            const deptEmployees = employees.filter(e => e.department === analyticsFilters.department).map(e => e.id);
            filteredTasks = filteredTasks.filter(t => deptEmployees.includes(String(t.assigned_to)));
        }

        if(!filteredTasks.length){
            hideLoader();
            return;
        }

        const activeProjects = projects.filter(p => p.status === "active").length;
        const openTasks = filteredTasks.filter(t => t.status?.toLowerCase() !== "closed").length;
        const closedTasks = filteredTasks.filter(t => t.status?.toLowerCase() === "closed").length;
        const overdueTasks = filteredTasks.filter(t => {if(!t.deadline || t.status?.toLowerCase() === "closed"){return false;} return new Date(t.deadline) < new Date();}).length;
        const dueToday = filteredTasks.filter(t => {if(!t.deadline) return false; const today = new Date().toISOString().split("T")[0]; return t.deadline === today;}).length;
        const html = `
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3> Executive Insights </h3>
                </div>
                <div id="predictiveInsightsContainer" class="dashboard-cards executive-insights-grid"> </div>
            </div>
            <div class="analytics-filters">
                <div class="form-field">
                    <label>Date Range</label>
                    <div class="select-wrapper">
                        <select id="analyticsRange" class="input-field select-field" onchange="updateAnalyticsFilters()">
                            <option value="7days" ${analyticsFilters.range === "7days" ? "selected" : "" }> Last 7 Days </option>
                            <option value="15days" ${analyticsFilters.range === "15days" ? "selected" : "" }> Last 15 Days </option>
                            <option value="30days" ${analyticsFilters.range === "30days" ? "selected" : "" }> Last 30 Days </option>
                            <option value="month" ${analyticsFilters.range === "month" ? "selected" : "" }> This Month </option>
                            <option value="quarter" ${analyticsFilters.range === "quarter" ? "selected" : "" }> This Quarter </option>
                            <option value="year" ${analyticsFilters.range === "year" ? "selected" : "" }> This Year </option>
                        </select>
                    </div>
                </div>
                <div class="form-field">
                    <label>Department</label>
                    <div class="select-wrapper">
                        <select id="analyticsDepartment" class="input-field select-field" onchange="updateAnalyticsFilters()">
                            <option value=""> All Departments </option>
                            ${departmentOptions}
                        </select>
                    </div>
                </div>
                <div class="form-field">
                    <label>Employee</label>
                    <div class="select-wrapper">
                        <select id="analyticsEmployee" class="input-field select-field" onchange="updateAnalyticsFilters()">
                            <option value=""> All Employees </option>
                            ${employeeOptions}
                        </select>
                    </div>
                </div>
            </div>
            <div class="dashboard-cards">
                <div class="dash-card">
                    <span>Active Projects</span>
                    <h2>${activeProjects}</h2>
                </div>
                <div class="dash-card">
                    <span>Open Tasks</span>
                    <h2>${openTasks}</h2>
                </div>
                <div class="dash-card">
                    <span>Closed Tasks</span>
                    <h2>${closedTasks}</h2>
                </div>
                <div class="dash-card">
                    <span>Overdue Tasks</span>
                    <h2>${overdueTasks}</h2>
                </div>
                <div class="dash-card">
                    <span>Tasks Due Today</span>
                    <h2>${dueToday}</h2>
                </div>
                <div class="dash-card">
                    <span>Active Employees</span>
                    <h2>${employees.length}</h2>
                </div>
            </div>
            <div class="chart-grid">
                <div class="chart-box">
                    <canvas id="taskStatusChart"></canvas>
                </div>
                <div class="chart-box">
                    <canvas id="projectHealthChart"></canvas>
                </div>
                <div class="chart-box">
                    <canvas id="departmentChart"></canvas>
                </div>
            </div>
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3> Project Intelligence </h3>
                </div>
                <div class="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                            <th>Project</th>
                            <th>Completion</th>
                            <th>Total Tasks</th>
                            <th>Closed</th>
                            <th>Overdue</th>
                            <th>Resources</th>
                            <th>Tracked Time</th>
                            <th>Health</th>
                            </tr>
                        </thead>
                        <tbody id="projectIntelligenceBody"></tbody>
                    </table>
                </div>
            </div>
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3> Resource Intelligence </h3>
                </div>
                <div class="table-wrapper">
                    <table>
                    <thead>
                        <tr>
                        <th>Employee</th>
                        <th>Projects</th>
                        <th>Active Tasks</th>
                        <th>Tracked Time</th>
                        <th>Utilization</th>
                        <th>Status</th>
                        </tr>
                    </thead>
                    <tbody id="resourceIntelligenceBody">
                    </tbody>
                    </table>
                </div>
            </div>
            <div class="card">
                <h3> Upcoming Deadlines </h3>
                <div class="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Task</th>
                                <th>Employee</th>
                                <th>Deadline</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody id="deadlineTableBody"></tbody>
                    </table>
                </div>
            </div>
            <div class="chart-grid">
                <div class="card">
                    <h3>Top Performers</h3>
                    <div class="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Employee</th>
                                <th>Closed Tasks</th>
                                <th>Efficiency</th>
                                <th>Tracked Hours</th>
                            </tr>
                        </thead>
                        <tbody id="topPerformersBody"></tbody>
                    </table>
                    </div>
                </div>
                <div class="card">
                    <h3>Resource Utilization</h3>
                    <div class="chart-box">
                        <canvas id="utilizationChart"></canvas>
                    </div>
                </div>
            </div>
            <div class="card">
                <h3> Smart Insights </h3>
                <div id="smartInsightsContainer"></div>
            </div>
        `;

        const container = document.getElementById("operationsDashboardSection");

        if(container){
            container.innerHTML = html;
        }

        renderPredictiveInsights(tasks, employees, projects, taskLogs);
        renderTaskStatusChart(filteredTasks);
        renderProjectHealthChart(filteredTasks, projects);
        renderProjectIntelligence(filteredTasks, projects, employees, taskLogs);
        renderResourceIntelligence(filteredTasks, employees, projects, taskLogs);
        renderUpcomingDeadlines(filteredTasks, employees);
        renderTopPerformers(filteredTasks, employees, taskLogs);
        renderUtilizationChart(filteredTasks, employees, taskLogs);
        generateSmartInsights(filteredTasks, employees);
        renderDepartmentChart(filteredTasks, employees);
        hideLoader();
    }

    function renderTaskStatusChart(tasks){
        Chart.getChart("taskStatusChart")?.destroy();
        const statusMap = {};
        tasks.forEach(t => {
            const status = t.status || "unknown";
            if(!statusMap[status]){
            statusMap[status] = 0;
            }
            statusMap[status]++;
        });

        new Chart(document.getElementById("taskStatusChart"),
            {
            type:"doughnut",
            data:{
                labels:Object.keys(statusMap),
                datasets:[{
                data:Object.values(statusMap)
                }]
            }
            }
        );
    }

    function renderProjectHealthChart(tasks, projects){
        Chart.getChart("projectHealthChart")?.destroy();
        const healthy = [];
        const risky = [];
        const critical = [];

        projects.forEach(project => {
            const projectTasks = tasks.filter(t => t.project_id === project.id);
            const overdue = projectTasks.filter(t => {
            if(!t.deadline || t.status?.toLowerCase() === "closed"){
                return false;
            }

            return new Date(t.deadline) < new Date();
            }).length;

            if(overdue === 0){
            healthy.push(project);
            }
            else if(overdue < 3){
            risky.push(project);
            }
            else{
            critical.push(project);
            }
        });

        new Chart(document.getElementById("projectHealthChart"),
            {
            type:"bar",
            data:{
                labels:[
                "Healthy",
                "At Risk",
                "Critical"
                ],

                datasets:[{
                    label:"Projects",
                    data:[
                        healthy.length,
                        risky.length,
                        critical.length
                    ]
                }]
            }
            }
        );
    }

    function renderUpcomingDeadlines(tasks, employees){
        const body = document.getElementById("deadlineTableBody");
        const upcoming = tasks.filter(t => {
            if(!t.deadline || t.status?.toLowerCase() === "closed"){
            return false;
            }

            return new Date(t.deadline) >= new Date();
        }).sort((a,b)=> new Date(a.deadline) - new Date(b.deadline)).slice(0,10);

        body.innerHTML = "";

        let status = "Pending";
        let statusClass = "warning";

        upcoming.forEach(task => {
            const emp = employees.find(e => String(e.id) === String(task.assigned_to));
            body.innerHTML += `
            <tr>
                <td>${task.title}</td>
                <td>${emp?.name || "-"}</td>
                <td>${task.deadline}</td>
                <td> <span class="status-badge ${statusClass}"> ${task.status} </span> </td>
            </tr>
            `;
        });
    }

    function renderTopPerformers(tasks, employees, taskLogs){
        const body = document.getElementById("topPerformersBody");

        if(!body) return;

        const employeeStats = {};
        employees.forEach(emp => {
            employeeStats[String(emp.id)] = {
                id: emp.id,
                name: emp.name,
                closed: 0,
                assigned: 0,
                tracked: 0
            };

        });

        tasks.forEach(task => {
            const empId = String(task.assigned_to);
            if(!employeeStats[empId]) return;

            employeeStats[empId].assigned++;

            if(task.status?.toLowerCase() === "closed"){
            employeeStats[empId].closed++;
            }
        });

        taskLogs.forEach(log => {const empId = String(log.employee_id);
            
            if(!employeeStats[empId]) return;

            employeeStats[empId].tracked += Number(log.duration || 0);
        });

        const ranking = Object.values(employeeStats).filter(emp => emp.assigned > 0).map(emp => 
            {
                const efficiency = emp.assigned > 0 
                    ? Math.round((emp.closed / emp.assigned) * 100) 
                        : 0 ; return {...emp, efficiency};
            }).sort((a,b)=> b.efficiency - a.efficiency).slice(0,10);
        body.innerHTML = "";
        ranking.forEach(emp => {
            body.innerHTML += `
            <tr onclick="openEmployeeAnalytics('${emp.id}')" style="cursor:pointer">
                <td>${emp.name}</td>
                <td>${emp.closed}</td>
                <td>
                ${emp.efficiency}%
                </td>
                <td>
                ${formatDuration(emp.tracked)}
                </td>
            </tr>
            `;
        });
    }

    function renderUtilizationChart(tasks, employees, taskLogs){
        Chart.getChart("utilizationChart")?.destroy();  

        const utilization = {};
        employees.forEach(emp => {
            utilization[String(emp.id)] = {
                name: emp.name,
                allotted_hours: 0,
                tracked: 0
            };
        });

        tasks.forEach(task => {
            const empId = String(task.assigned_to);
            if(!utilization[empId]) return;

            utilization[empId].allotted_hours += Number(task.allotted_hours || 0);
        });

        taskLogs.forEach(log => {
            const empId = String(log.employee_id);
            if(!utilization[empId]) return;

            utilization[empId].tracked += (Number(log.duration || 0) / 3600);
        });

        const labels = [];
        const values = [];

        Object.values(utilization).forEach(emp => {
        const percent = emp.allotted_hours > 0 ? Math.round((emp.tracked / emp.allotted_hours) * 100) : 0;
        labels.push(emp.name);
        values.push(percent);
        });

        new Chart(document.getElementById("utilizationChart"),
        {
            type:"bar",

            data:{
            labels,
            datasets:[{
                label:"Utilization %",
                data:values
            }]
            }
        }
        );
    }

    function generateSmartInsights(tasks, employees){
        const container = document.getElementById("smartInsightsContainer");

        if(!container) return;

        const insights = [];
        const overdue = tasks.filter(t => {
        if(!t.deadline || t.status?.toLowerCase() === "closed"
        ){
            return false;
        }

        return new Date(t.deadline) < new Date();
        });

        if(overdue.length > 0){
        insights.push(`${overdue.length} overdue tasks require attention`);
        }

        const heavyEmployees = {};
        tasks.forEach(task => {
        if(task.status?.toLowerCase() === "closed") return;

        if(!heavyEmployees[String(task.assigned_to)]){
            heavyEmployees[String(task.assigned_to)] = 0;
        }

        heavyEmployees[String(task.assigned_to)]++;
        });

        Object.entries(heavyEmployees).forEach(([empId,count]) => {
        if(count >= 10){
            const emp = employees.find(e => String(e.id) === String(empId));
            insights.push(`${emp?.name} is overloaded with ${count} active tasks`);
        }
        });

        if(insights.length === 0){
        insights.push("No operational risks detected");
        }

        container.innerHTML = insights.map(i => `<div class="insight-card"> ${i} </div>`).join("");
    }

    async function loadAnalyticsFilters(){
        const { data: employees } = await db
        .from("employees")
        .select("*")
        .order("name");

        const deptSelect = document.getElementById("analyticsDepartment");
        const empSelect = document.getElementById("analyticsEmployee");

        if(!deptSelect || !empSelect){
            return;
        }

        const departments = [...new Set(employees.map(e => e.department).filter(Boolean))];

        departments.forEach(dept => {
            deptSelect.innerHTML += `<option value="${dept}"> ${dept} </option>`;
        });

        employees.forEach(emp => {
            empSelect.innerHTML += `<option value="${emp.id}"> ${emp.name} </option>`;
        });
    }

    function updateAnalyticsFilters(){
        analyticsFilters.range = document.getElementById("analyticsRange").value;
        analyticsFilters.department = document.getElementById("analyticsDepartment").value || null;
        analyticsFilters.employee = document.getElementById("analyticsEmployee").value || null;

        loadExecutiveAnalytics();
    }

    function renderDepartmentChart(tasks, employees){
        Chart.getChart("departmentChart")?.destroy();
        const departmentStats = {};
        employees.forEach(emp => {
            const dept = emp.department || "Other";

            if(!departmentStats[dept]){
            departmentStats[dept] = {assigned:0, closed:0};
            }
        });

        tasks.forEach(task => {
            const emp = employees.find(e => String(e.id) === String(task.assigned_to));

            if(!emp) return;

            const dept = emp.department || "Other";
            departmentStats[dept].assigned++;

            if(task.status?.toLowerCase() === "closed"){
            departmentStats[dept].closed++;
            }
        });

        const labels = [];
        const values = [];

        Object.entries(departmentStats).forEach(([dept,data]) => {
            const efficiency = data.assigned > 0 ? Math.round((data.closed / data.assigned) * 100) : 0;
            labels.push(dept);
            values.push(efficiency);
        });

        new Chart(document.getElementById("departmentChart"),
            {
            type:"bar",

            data:{
                labels,
                datasets:[{
                label:"Department Efficiency %",
                data:values
                }]
            }
            }
        );
    }

    function closeEmployeeAnalytics(){
    document.getElementById("employeeAnalyticsModal").style.display = "none";
    }

    async function openEmployeeAnalytics(employeeId){
        showLoader("Loading employee analytics...");
        const modal = document.getElementById("employeeAnalyticsModal");
        modal.style.display = "flex";

        const { data: employee } = await db
        .from("employees")
        .select("*")
        .eq("id",employeeId)
        .single();

        const { data: tasks } = await db
        .from("tasks")
        .select("*")
        .eq("assigned_to",employeeId);

        const { data: logs } = await db
        .from("task_logs")
        .select("*")
        .eq("employee_id",employeeId);

        if(!employee || !tasks || !logs){
            hideLoader();
            showToast("Failed to load employee analytics", "error");
            return;
        }

        const closedTasks = tasks.filter(t => t.status?.toLowerCase() === "closed");
        const openTasks = tasks.filter(t => t.status?.toLowerCase() !== "closed");
        const overdueTasks = tasks.filter(t => {
            if(!t.deadline || t.status?.toLowerCase() === "closed"
            ){
            return false;
            }

            return new Date(t.deadline) < new Date();
        });

        let trackedHours = 0;

        logs.forEach(log => {trackedHours += Number(log.duration || 0);});

        const efficiency = tasks.length > 0 ? Math.round((closedTasks.length / tasks.length) * 100) : 0;
        const html = `
            <div class="dashboard-cards">
            <div class="dash-card">
                <span>Assigned Tasks</span>
                <h2>${tasks.length}</h2>
            </div>
            <div class="dash-card">
                <span>Closed Tasks</span>
                <h2>${closedTasks.length}</h2>
            </div>
            <div class="dash-card">
                <span>Open Tasks</span>
                <h2>${openTasks.length}</h2>
            </div>
            <div class="dash-card">
                <span>Overdue Tasks</span>
                <h2>${overdueTasks.length}</h2>
            </div>
            <div class="dash-card">
                <span>Efficiency</span>
                <h2>${efficiency}%</h2>
            </div>
            <div class="dash-card">
                <span>Tracked Hours</span>
                <h2>${formatDuration(trackedHours)}</h2>
            </div>
            </div>
            <div class="chart-grid">
            <div class="chart-box">
                <canvas id="employeeTaskChart"></canvas>
            </div>
            <div class="chart-box">
                <canvas id="employeeTimelineChart"></canvas>
            </div>
            </div>
            <div class="card">
            <h3> Recent Tasks </h3>
            <div class="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                            <th>Task</th>
                            <th>Status</th>
                            <th>Deadline</th>
                            <th>Allocated</th>
                            </tr>
                        </thead>
                        <tbody id="employeeTasksBody"></tbody>
                    </table>
            </div>
            </div>
        `;

        document.getElementById("employeeAnalyticsTitle").innerText = `${employee.name} Analytics`;
        document.getElementById("employeeAnalyticsContent").innerHTML = html;

        renderEmployeeTaskChart(closedTasks, openTasks, overdueTasks);
        renderEmployeeTimeline(logs);
        renderEmployeeTasks(tasks);

        hideLoader();
    }

    function renderEmployeeTaskChart(closedTasks, openTasks, overdueTasks){
        Chart.getChart("employeeTaskChart")?.destroy();
        new Chart(document.getElementById("employeeTaskChart"),
            {
            type:"doughnut",
            data:{
                labels:[
                "Closed",
                "Open",
                "Overdue"
                ],

                datasets:[{
                data:[
                    closedTasks.length,
                    openTasks.length,
                    overdueTasks.length
                ]
                }]
            }
            }
        );
    }

    function renderEmployeeTimeline(logs){
        Chart.getChart("employeeTimelineChart")?.destroy();
        const daily = {};

        logs.forEach(log => {
            if(!log.created_at) return;

            const day = log.created_at.split("T")[0];

            if(!daily[day]){
            daily[day] = 0;
            }

            daily[day] += (Number(log.duration || 0) / 3600);
        });

        new Chart(document.getElementById("employeeTimelineChart"),
            {
            type:"line",

            data:{
                labels:Object.keys(daily),

                datasets:[{
                label:"Tracked Hours",
                data:Object.values(daily),
                tension:0.3
                }]
            }
            }
        );
    }

    function renderEmployeeTasks(tasks){
    const body = document.getElementById("employeeTasksBody");
    body.innerHTML = "";
    tasks.slice(0,10).forEach(task => {
        let status = "";
        let statusClass = "";

        const taskStatus = task.status?.toLowerCase();

        if(taskStatus === "closed"){
            status = "Completed";
            statusClass = "success";
        }
        else if(taskStatus === "in_progress" || taskStatus === "review" || taskStatus === "submitted"){
            status = "Working";
            statusClass = "warning";
        }
        else if(taskStatus === "pending"){
            status = "Pending";
            statusClass = "normal";
        }

        body.innerHTML += `
        <tr>
            <td>${task.title}</td>
            <td> <span class="status-badge ${statusClass}"> ${status} </span> </td>
            <td> ${task.deadline || "-"} </td>
            <td> ${task.allotted_hours || 0} hrs </td>
        </tr>
        `;
    });
    }

    function renderProjectIntelligence(tasks, projects, employees, taskLogs){
        const body = document.getElementById("projectIntelligenceBody");
        if(!body) return;

        body.innerHTML = "";
        projects.forEach(project => {
            const projectTasks = tasks.filter(t => String(t.project_id) === String(project.id));
            const totalTasks = projectTasks.length;
            const closedTasks = projectTasks.filter(t => t.status?.toLowerCase() === "closed").length;
            const overdueTasks = projectTasks.filter(t => 
                {
                    if(!t.deadline || t.status?.toLowerCase() === "closed"){return false;}
                    return new Date(t.deadline) < new Date();
                }).length;
            const completion = totalTasks > 0 ? Math.round((closedTasks / totalTasks) * 100) : 0;
            const resourceIds = [...new Set(projectTasks.map(t => String(t.assigned_to)))];
            
            let trackedSeconds = 0;
            projectTasks.forEach(task => {
            const logs = taskLogs.filter(l => String(l.task_id) === String(task.id));
            logs.forEach(log => {trackedSeconds += Number(log.duration || 0);});
            });

            let health = "Healthy";
            let healthClass = "success";

            if(overdueTasks >= 1){
            health = "At Risk";
            healthClass = "warning";
            }

            if(overdueTasks >= 4){
            health = "Critical";
            healthClass = "danger";
            }

            body.innerHTML += `
            <tr onclick="openProjectAnalytics('${project.id}')" style="cursor:pointer">
                <td> ${project.name} </td>
                <td> ${completion}% </td>
                <td> ${totalTasks} </td>
                <td> ${closedTasks} </td>
                <td> ${overdueTasks} </td>
                <td> ${resourceIds.length} </td>
                <td> ${formatDuration(trackedSeconds)} </td>
                <td> <span class="status-badge ${healthClass}"> ${health} </span> </td>
            </tr>
            `;
        });
    }

    function closeProjectAnalytics(){
      document.getElementById("projectAnalyticsModal").style.display = "none";
    }

    async function openProjectAnalytics(projectId){
        showLoader("Loading project analytics...");
        const modal = document.getElementById("projectAnalyticsModal");
        modal.style.display = "flex";

        const { data: project } = await db
        .from("projects")
        .select("*")
        .eq("id",projectId)
        .single();

        const { data: tasks } = await db
        .from("tasks")
        .select("*")
        .eq("project_id",projectId);

        const { data: employees } = await db
        .from("employees")
        .select("*");

        const { data: taskLogs } = await db
        .from("task_logs")
        .select("*");

        if(!project || !tasks || !employees || !taskLogs){
            hideLoader();
            return;
        }

        const closedTasks = tasks.filter(t => t.status?.toLowerCase() === "closed");
        const openTasks = tasks.filter(t => t.status?.toLowerCase() !== "closed");
        const overdueTasks = tasks.filter(t => {if(!t.deadline || t.status?.toLowerCase() === "closed"){return false;} return new Date(t.deadline) < new Date();});
        const completion = tasks.length > 0 ? Math.round((closedTasks.length / tasks.length) * 100) : 0;
        const resourceIds = [...new Set(tasks.map(t => String(t.assigned_to)))];

        let trackedSeconds = 0;

        tasks.forEach(task => {
            const logs = taskLogs.filter(l => String(l.task_id) === String(task.id));
            logs.forEach(log => {trackedSeconds += Number(log.duration || 0);});
        });

        const html = `
            <div class="dashboard-cards">
            <div class="dash-card">
                <span>Total Tasks</span>
                <h2>${tasks.length}</h2>
            </div>
            <div class="dash-card">
                <span>Closed Tasks</span>
                <h2>${closedTasks.length}</h2>
            </div>
            <div class="dash-card">
                <span>Open Tasks</span>
                <h2>${openTasks.length}</h2>
            </div>
            <div class="dash-card">
                <span>Overdue Tasks</span>
                <h2>${overdueTasks.length}</h2>
            </div>
            <div class="dash-card">
                <span>Completion</span>
                <h2>${completion}%</h2>
            </div>
            <div class="dash-card">
                <span>Tracked Time</span>
                <h2> ${formatDuration(trackedSeconds)} </h2>
            </div>
            <div class="dash-card">
                <span>Resources</span>
                <h2>${resourceIds.length}</h2>
            </div>
            </div>
            <div class="chart-grid">
            <div class="chart-box">
                <canvas id="projectTaskChart"></canvas>
            </div>
            <div class="chart-box">
                <canvas id="projectContributionChart"></canvas>
            </div>
            </div>
            <div class="card">
            <h3> Project Tasks </h3>
            <div class="table-wrapper">
                <table>
                <thead>
                    <tr>
                    <th>Task</th>
                    <th>Employee</th>
                    <th>Status</th>
                    <th>Deadline</th>
                    </tr>
                </thead>
                <tbody id="projectTasksBody"></tbody>
                </table>
            </div>
            </div>
        `;

        document.getElementById("projectAnalyticsTitle").innerText = `${project.name} Analytics`;
        document.getElementById("projectAnalyticsContent").innerHTML = html;

        renderProjectTaskChart(closedTasks, openTasks, overdueTasks);
        renderProjectContributionChart(tasks, employees, taskLogs);
        renderProjectTasks(tasks, employees);

        hideLoader();
    }

    function renderProjectTaskChart(closedTasks, openTasks, overdueTasks){
        Chart.getChart("projectTaskChart")?.destroy();
        new Chart(document.getElementById("projectTaskChart"),
        {
            type:"doughnut",
            data:{
                labels:["Closed", "Open", "Overdue"],
                datasets:[{
                data:[
                    closedTasks.length,
                    openTasks.length,
                    overdueTasks.length
                ]
                }]
            }
        });
    }

    function renderProjectContributionChart(tasks, employees, taskLogs){
        Chart.getChart("projectContributionChart")?.destroy();

        const contribution = {};
        employees.forEach(emp => {
            contribution[String(emp.id)] = {
                name:emp.name,
                duration:0
            };
        });

        taskLogs.forEach(log => {
            const task = tasks.find(t => String(t.id) === String(log.task_id));

            if(!task) return;

            const empId = String(log.employee_id);

            if(!contribution[empId]){
            return;
            }

            contribution[empId].duration += Number(log.duration || 0);
        });

        const labels = [];
        const values = [];

        Object.values(contribution).forEach(emp => {
            if(emp.duration <= 0)
                {
                    return;
                }
            
            labels.push(emp.name);
            values.push(Number((emp.duration / 3600).toFixed(1))
            );
        });

        new Chart(document.getElementById("projectContributionChart"),
            {
            type:"bar",
            data:{
                labels,
                datasets:[{
                    label:"Tracked Hours",
                    data:values
                }]
            }
            }
        );
    }

    function renderProjectTasks(tasks, employees){
        const body = document.getElementById("projectTasksBody");
        const today = new Date();
        body.innerHTML = "";

        tasks.forEach(task => {
            const emp = employees.find(e => String(e.id) === String(task.assigned_to));

            let status = "";
            let statusClass = "";
            let deadlineClass = "";

            const taskStatus = task.status?.toLowerCase();

            if(taskStatus === "closed"){
                status = "Completed";
                statusClass = "success";
            }
            else if(taskStatus === "in_progress" || taskStatus === "review" || taskStatus === "submitted"){
                status = "Working";
                statusClass = "warning";
            }
            else if(taskStatus === "pending"){
                status = "Pending";
                statusClass = "normal";
            }

            if(task.deadline){
                const today = new Date();
                const deadline = new Date(task.deadline);
                const diffInDays = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));

                if(diffInDays < 0 && taskStatus !== "closed"){
                    deadlineClass = "danger";
                }
                else if(diffInDays <= 3 && taskStatus !== "closed"){
                    deadlineClass = "warning";
                }
            }

            body.innerHTML += `
            <tr>
                <td> ${task.title} </td>
                <td> ${emp?.name || "-"} </td>
                <td> <span class="status-badge ${statusClass}"> ${status} </span> </td>
                <td> <span class="status-badge ${deadlineClass}"> ${task.deadline || "-"} </span> </td>
            </tr>
            `;
        });
    }

    function renderResourceIntelligence(tasks, employees, projects, taskLogs){
        const body = document.getElementById("resourceIntelligenceBody");

        if(!body) return;
        body.innerHTML = "";
        employees.forEach(emp => {
            const empTasks = tasks.filter(t => String(t.assigned_to) === String(emp.id));
            const activeTasks =empTasks.filter(t => t.status?.toLowerCase() !== "closed");
            const projectIds = [...new Set(empTasks.map(t => String(t.project_id)))];

            let trackedSeconds = 0;

            taskLogs.forEach(log => {
                if(String(log.employee_id) !== String(emp.id)){
                    return;
                }

                trackedSeconds += Number(log.duration || 0);
            });

            const allocatedHours = empTasks.reduce((sum,task)=> sum + Number(task.allocated_hours || 0), 0);
            const trackedHours = trackedSeconds / 3600;
            const utilization = allocatedHours > 0 ? Math.round((trackedHours / allocatedHours) * 100) : 0;

            let status = "Healthy";
            let statusClass = "success";

            if(activeTasks.length >= 10 || utilization >= 120){
                status = "Overloaded";
                statusClass = "danger";
            }

            if(activeTasks.length <= 1 && utilization <= 20){
                status = "Underutilized";
                statusClass = "warning";
            }

            body.innerHTML += `
            <tr>
                <td>${emp.name}</td>
                <td>${projectIds.length}</td>
                <td>${activeTasks.length} </td>
                <td>${formatDuration(trackedSeconds)} </td>
                <td> ${utilization}% </td>
                <td> <span class="status-badge ${statusClass}"> ${status} </span> </td>
            </tr>`;
        });
    }

    function renderPredictiveInsights(tasks, employees, projects, taskLogs){
        const container = document.getElementById("predictiveInsightsContainer");

        if(!container) return;

        let criticalProjects = 0;
        let burnoutEmployees = 0;
        let dependencyProjects = 0;
        let overdueTasks = 0;

        projects.forEach(project => {
            const projectTasks = tasks.filter(t => String(t.project_id) === String(project.id));
            const overdue = projectTasks.filter(t => {
                if(!t.deadline || t.status?.toLowerCase() === "closed"){
                    return false;
                }

                return new Date(t.deadline) < new Date();
            });

            overdueTasks += overdue.length;

            const completion = projectTasks.length > 0 ? (projectTasks.filter(t => t.status?.toLowerCase() === "closed").length / projectTasks.length) * 100 : 0;

            if(overdue.length >= 3 && completion <= 50){
                criticalProjects++;
            }

            const contribution = {};

            taskLogs.forEach(log => {
                const task = projectTasks.find(t => String(t.id) === String(log.task_id));

                if(!task) return;

                const empId = String(log.employee_id);

                if(!contribution[empId]){
                    contribution[empId] = 0;
                }

                contribution[empId] += Number(log.duration || 0);
            });

            const totalContribution =Object.values(contribution).reduce((a,b)=>a+b,0);

            Object.values(contribution).forEach(duration => {
            const percent = totalContribution > 0 ? (duration / totalContribution ) * 100 : 0;

            if(percent >= 70){
                dependencyProjects++;
            }
            });
        });

        employees.forEach(emp => {
            const empTasks = tasks.filter(t => String(t.assigned_to) === String(emp.id));
            const activeTasks = empTasks.filter(t =>t.status?.toLowerCase() !== "closed");

            let trackedSeconds = 0;

            taskLogs.forEach(log => {
                if(String(log.employee_id) !== String(emp.id)){
                    return;
                }

                trackedSeconds += Number(log.duration || 0);
            });

            const trackedHours = trackedSeconds / 3600;

            if(activeTasks.length >= 10 || trackedHours >= 40){
                burnoutEmployees++;
            }
        });

        container.innerHTML = `
            <div class="executive-card danger">
            <div class="executive-card-top">
                <span class="executive-label"> Critical Projects </span>
                <div class="executive-icon"> 🚨 </div>
            </div>
            <h2> ${criticalProjects} </h2>
            <p> Projects likely to miss deadlines </p>
            </div>

            <div class="executive-card warning">
            <div class="executive-card-top">
                <span class="executive-label"> Burnout Risk </span>
                <div class="executive-icon"> ⚠️ </div>
            </div>
            <h2> ${burnoutEmployees} </h2>
            <p> Employees under workload pressure </p>
            </div>

            <div class="executive-card primary">
            <div class="executive-card-top">
                <span class="executive-label"> Resource Dependency </span>
                <div class="executive-icon"> 🔗 </div>
            </div>

            <h2> ${dependencyProjects} </h2>
            <p> Projects dependent on single resources </p>
            </div>
            <div class="executive-card success">
            <div class="executive-card-top">
                <span class="executive-label"> Overdue Tasks </span>
                <div class="executive-icon"> 📌 </div>
            </div>

            <h2> ${overdueTasks} </h2>
            <p> Tasks requiring immediate attention </p>
            </div>`;
    }