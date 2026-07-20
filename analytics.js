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

    function deriveIterationTaskStats(tasks, iterations = null){
        (tasks || []).forEach(task => {
            const planned = (iterations || task.task_iterations || [])
                .filter(i => !iterations || String(i.task_id) === String(task.id))
                .sort((a,b)=>Number(a.iteration_no)-Number(b.iteration_no));
            task.planned_iteration_count = planned.length;
            if(!planned.length) return;
            task.allotted_hours = planned.reduce((sum,i)=>sum+Number(i.allotted_hours||0),0);
            task.deadline = planned.map(i=>i.deadline).filter(Boolean).sort().at(-1)||null;
            task.revision_count = planned.reduce((sum,i)=>sum+Number(i.revision_count||0),0);
        });
        return tasks || [];
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

        const { data: estimationHistory } = await db
        .from("task_estimation_history")
        .select("*");

        const { data: deadlineHistory } = await db
        .from("task_deadline_history")
        .select("*");

        const { data: taskIterations } = await db
        .from("task_iterations")
        .select("*");

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

        /* Iterations are the planning source of truth. Keep the task-shaped
           analytics API, but derive its totals from the planned iterations. */
        tasks.forEach(task => {
            const planned = taskIterations
                .filter(i => String(i.task_id) === String(task.id))
                .sort((a,b) => Number(a.iteration_no) - Number(b.iteration_no));
            if(!planned.length){
                task.planned_iteration_count = 0;
                task.on_time_iteration_count = 0;
                task.breached_iteration_count = 0;
                return;
            }
            task.planned_iteration_count = planned.length;
            task.allotted_hours = planned.reduce((sum,i)=>sum + Number(i.allotted_hours || 0),0);
            task.deadline = planned.map(i=>i.deadline).filter(Boolean).sort().at(-1) || null;
            task.revision_count = planned.reduce((sum,i)=>sum + Number(i.revision_count || 0),0);
            task.on_time_iteration_count = planned.filter(i => i.submitted_at && i.deadline && new Date(i.submitted_at) <= new Date(`${i.deadline}T23:59:59`)).length;
            task.breached_iteration_count = planned.filter(i => i.submitted_at && i.deadline && new Date(i.submitted_at) > new Date(`${i.deadline}T23:59:59`)).length;
        });

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

        const closedTasksData = filteredTasks.filter(t => t.status?.toLowerCase() === "closed");
        const totalIterations = closedTasksData.reduce((sum, task) => sum + Number(task.planned_iteration_count || 0), 0);
        const totalRevisions = closedTasksData.reduce((sum, task) => sum + Number(task.revision_count || 0), 0);
        const firstPassTasks = closedTasksData.filter(t => Number(t.revision_count || 0) === 0).length;
        const avgIterations = closedTasksData.length > 0 ? (totalIterations / closedTasksData.length).toFixed(2) : 0;
        const firstPassRate = closedTasksData.length > 0 ? Math.round((firstPassTasks / closedTasksData.length) * 100) : 0;
        const revisionRate = closedTasksData.length > 0 ? Math.round((closedTasksData.filter(t => Number(t.revision_count || 0) > 0).length / closedTasksData.length) * 100) : 0;
        const avgRevisions = closedTasksData.length > 0 ? (totalRevisions / closedTasksData.length).toFixed(2) : 0;
        let totalEstimatedHours = 0;
        let totalActualHours = 0;

        const totalDeadlineExtensions = deadlineHistory.length;
        const extendedTaskIds = [...new Set(deadlineHistory.map(x => String(x.task_id)))];
        const extendedTasks = extendedTaskIds.length;
        const planningInstability = filteredTasks.length > 0 ? Math.round((extendedTasks / filteredTasks.length) * 100) : 0;

        let missedAfterExtension = 0;

        extendedTaskIds.forEach(taskId => {
            const task = closedTasksData.find(t => String(t.id) === String(taskId));

            if(!task || !task.deadline || !task.closed_at){
                return;
            }

            if(new Date(task.closed_at) > new Date(task.deadline)){ 
                missedAfterExtension++; 
            }
        });

        const taskActualHoursMap = {};

        taskLogs.forEach(log => {
            const taskId = String(log.task_id);

            if(!taskActualHoursMap[taskId]){
                taskActualHoursMap[taskId] = 0;
            }

            taskActualHoursMap[taskId] += Number(log.duration || 0) / 3600;
        });

        const totalEstimateRevisions = estimationHistory.length;
        const reEstimatedTaskIds = [...new Set(estimationHistory.map(x => String(x.task_id)))];
        const reEstimatedTasks = reEstimatedTaskIds.length;

        let originalEstimateHours = 0;
        let currentEstimateHours = 0;

        filteredTasks.forEach(task => {
        originalEstimateHours += Number(task.original_allotted_hours || task.allotted_hours || 0);
        currentEstimateHours += Number(task.allotted_hours || 0);
        });

        const scopeCreepPercent = originalEstimateHours > 0 ? Math.round(((currentEstimateHours - originalEstimateHours) / originalEstimateHours) * 100) : 0;
        const avgEstimateRevisions = reEstimatedTasks > 0 ? (totalEstimateRevisions / reEstimatedTasks).toFixed(1) : 0;
        const planningVolatility = filteredTasks.length > 0 ? Math.round((reEstimatedTasks / filteredTasks.length) * 100) : 0;

        closedTasksData.forEach(task => {
            const estimated = Number(task.allotted_hours || 0);
            const actual = Number(taskActualHoursMap[String(task.id)] || 0);
            totalEstimatedHours += estimated;
            totalActualHours += actual;
        });

        const estimationBuckets = {excellent: 0, good: 0, average: 0, poor: 0};

        closedTasksData.forEach(task=>{
            const estimated = Number(task.allotted_hours || 0);
            const actual = Number(taskActualHoursMap[String(task.id)] || 0);

            if(estimated <= 0){
                return;
            }

            const variancePercent = (Math.abs(actual - estimated) / estimated) * 100;
            const accuracy = Math.max(0, 100 - variancePercent);

            if(accuracy >= 90){
                estimationBuckets.excellent++;
            }
            else if(accuracy >= 70){
                estimationBuckets.good++;
            }
            else if(accuracy >= 50){
                estimationBuckets.average++;
            }
            else{
                estimationBuckets.poor++;
            }

        });

        const varianceHours = Number((totalActualHours - totalEstimatedHours).toFixed(1));
        const estimationAccuracy = totalActualHours > 0 ? Math.min(100, Math.round((totalEstimatedHours / totalActualHours) * 100)) : 100;
        const overrunTasks = closedTasksData.filter(task => {
                const estimated = Number(task.allotted_hours || 0);
                const actual = Number(taskActualHoursMap[String(task.id) ] || 0);

                return actual > estimated;
            }).length;

        const overrunRate = closedTasksData.length > 0 ? Math.round((overrunTasks / closedTasksData.length) * 100) : 0;
        const perfectEstimateTasks = closedTasksData.filter(task => {
            const estimated = Number(task.allotted_hours || 0);
            const actual = Number(taskActualHoursMap[String(task.id)] || 0);

            if(estimated <= 0){
                return false;
            }

            const variancePercent = Math.abs(actual - estimated) / estimated * 100;

            return variancePercent <= 10;

        }).length;

        const underEstimatedTasks = closedTasksData.filter(task => {
            const estimated = Number(task.allotted_hours || 0);
            const actual = Number(taskActualHoursMap[String(task.id)] || 0);

            return actual > estimated;
        }).length;

        const overEstimatedTasks = closedTasksData.filter(task => {
            const estimated = Number(task.allotted_hours || 0);
            const actual = Number(taskActualHoursMap[String(task.id)] || 0);

            return actual < estimated;
        }).length;

        const closedTasksWithDeadline = closedTasksData.filter(t => t.deadline && t.closed_at);

        let breachedTasks = 0;
        let totalDelayDays = 0;
        let worstDelayDays = 0;

        closedTasksWithDeadline.forEach(task => {
            const deadline = new Date(task.deadline);
            const closedAt = new Date(task.closed_at);

            if(closedAt > deadline){
                const delayDays = Math.ceil((closedAt - deadline) / (1000 * 60 * 60 * 24));

                breachedTasks++;
                totalDelayDays += delayDays;

                if(delayDays > worstDelayDays){
                    worstDelayDays = delayDays;
                }
            }
        });

        const onTimeTasks = closedTasksWithDeadline.length - breachedTasks;
        const onTimeRate = closedTasksWithDeadline.length > 0 ? Math.round((onTimeTasks / closedTasksWithDeadline.length) * 100) : 100;
        const breachRate = closedTasksWithDeadline.length > 0 ? Math.round((breachedTasks / closedTasksWithDeadline.length) * 100) : 0;
        const avgDelayDays = breachedTasks > 0 ? (totalDelayDays / breachedTasks).toFixed(1) : 0;

        let totalTrackedHours = 0;
        let totalReworkHours = 0;
        let highReworkTasks = 0;

        closedTasksData.forEach(task => {
            const taskId = String(task.id);
            const iterations = taskIterations.filter(i => String(i.task_id) === taskId).sort((a,b) => Number(a.iteration_no) - Number(b.iteration_no));

            if(iterations.length === 0){
                return;
            }

            let taskTotalHours = 0;
            let revisionHours = 0;

            iterations.forEach((iteration,index) => {
                const iterationHours = taskLogs.filter(log => String(log.iteration_id) === String(iteration.id)).reduce((sum,log) => sum + (Number(log.duration || 0) / 3600), 0);
                taskTotalHours += iterationHours;

                revisionHours += taskLogs
                    .filter(log => String(log.iteration_id) === String(iteration.id) && Number(log.revision_no || 0) > 0)
                    .reduce((sum,log) => sum + (Number(log.duration || 0) / 3600), 0);
            });

            const reworkHours = revisionHours;

            totalTrackedHours += taskTotalHours;
            totalReworkHours += reworkHours;

            const reworkPercent = taskTotalHours > 0 ? (reworkHours / taskTotalHours) * 100 : 0;

            if(reworkPercent >= 50){
                highReworkTasks++;
            }
        });

        const reworkPercentage = totalTrackedHours > 0 ? Math.round((totalReworkHours / totalTrackedHours) * 100) : 0;
        const revisedTaskCount = closedTasksData.filter(t => Number(t.revision_count || 0) > 0).length;
        const avgReworkPerTask = revisedTaskCount > 0 ? (totalReworkHours / revisedTaskCount).toFixed(1) : 0;
                
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
            <div class="dashboard-cards">
                <div class="dash-card">
                    <span>Avg Iterations</span>
                    <h2>${avgIterations}</h2>
                </div>
                <div class="dash-card">
                    <span>First Pass Rate</span>
                    <h2>${firstPassRate}%</h2>
                </div>
                <div class="dash-card">
                    <span>Revision Rate</span>
                    <h2>${revisionRate}%</h2>
                </div>
                <div class="dash-card">
                    <span>Avg Revisions</span>
                    <h2>${avgRevisions}</h2>
                </div>
            </div>
            <div class="dashboard-cards">
                <div class="dash-card">
                    <span>Estimation Accuracy</span>
                    <h2>${estimationAccuracy}%</h2>
                </div>
                <div class="dash-card">
                    <span>Variance Hours</span>
                    <h2>${varianceHours}</h2>
                </div>
                <div class="dash-card">
                    <span>Estimated Hours</span>
                    <h2>${totalEstimatedHours.toFixed(1)}</h2>
                </div>
                <div class="dash-card">
                    <span>Actual Hours</span>
                    <h2>${totalActualHours.toFixed(1)}</h2>
                </div>
                <div class="dash-card">
                    <span>Overrun Rate</span>
                    <h2>${overrunRate}%</h2>
                </div>
            </div>
            <div class="dashboard-cards">
                <div class="dash-card">
                    <span>Perfect Estimates</span>
                    <h2>${perfectEstimateTasks}</h2>
                </div>

                <div class="dash-card">
                    <span>Under Estimated</span>
                    <h2>${underEstimatedTasks}</h2>
                </div>

                <div class="dash-card">
                    <span>Over Estimated</span>
                    <h2>${overEstimatedTasks}</h2>
                </div>
            </div>
            <div class="dashboard-cards">
                <div class="dash-card">
                    <span>On Time Delivery</span>
                    <h2>${onTimeRate}%</h2>
                </div>
                <div class="dash-card">
                    <span>Late Delivery</span>
                    <h2>${breachRate}%</h2>
                </div>
                <div class="dash-card">
                    <span>Avg Delay</span>
                    <h2>${avgDelayDays}d</h2>
                </div>
                <div class="dash-card">
                    <span>Worst Delay</span>
                    <h2>${worstDelayDays}d</h2>
                </div>
                <div class="dash-card">
                    <span>Breached Tasks</span>
                    <h2>${breachedTasks}</h2>
                </div>
            </div>
            <div class="dashboard-cards">
                <div class="dash-card">
                    <span>Rework Hours</span>
                    <h2>${totalReworkHours.toFixed(1)}</h2>
                </div>
                <div class="dash-card">
                    <span>Rework %</span>
                    <h2>${reworkPercentage}%</h2>
                </div>
                <div class="dash-card">
                    <span>Avg Rework</span>
                    <h2>${avgReworkPerTask}h</h2>
                </div>
                <div class="dash-card">
                    <span>High Rework Tasks</span>
                    <h2>${highReworkTasks}</h2>
                </div>
            </div>
            <div class="dashboard-cards">
                <div class="dash-card">
                    <span>Deadline Extensions</span>
                    <h2>${totalDeadlineExtensions}</h2>
                </div>

                <div class="dash-card">
                    <span>Extended Tasks</span>
                    <h2>${extendedTasks}</h2>
                </div>

                <div class="dash-card">
                    <span>Planning Instability</span>
                    <h2>${planningInstability}%</h2>
                </div>

                <div class="dash-card">
                    <span>Missed After Extension</span>
                    <h2>${missedAfterExtension}</h2>
                </div>
            </div>
            <div class="dashboard-cards">
                <div class="dash-card">
                    <span>Estimate Revisions</span>
                    <h2>${totalEstimateRevisions}</h2>
                </div>
                <div class="dash-card">
                    <span>Re Estimated Tasks</span>
                    <h2>${reEstimatedTasks}</h2>
                </div>
                <div class="dash-card">
                    <span>Avg Revisions</span>
                    <h2>${avgEstimateRevisions}</h2>
                </div>
                <div class="dash-card">
                    <span>Scope Creep</span>
                    <h2>${scopeCreepPercent}%</h2>
                </div>
                <div class="dash-card">
                    <span>Planning Volatility</span>
                    <h2>${planningVolatility}%</h2>
                </div>
            </div>
            <div class="chart-grid">
                <div class="card">
                    <h3>Task Status Distribution</h3>
                    <div class="chart-box">
                        <canvas id="taskStatusChart"></canvas>
                    </div>
                </div>
                <div class="card">
                    <h3>Task Health Distribution</h3>
                    <div class="chart-box">
                        <canvas id="projectHealthChart"></canvas>
                    </div>
                </div>
                <div class="card">
                    <h3>Department Health Distribution</h3>
                    <div class="chart-box">
                        <canvas id="departmentChart"></canvas>
                    </div>
                </div>
            </div>
            <div class="chart-grid"> 
                <div class="card">
                    <h3>Iteration Distribution</h3>
                    <div class="chart-box">
                        <canvas id="iterationDistributionChart"></canvas>
                    </div>
                </div>
                <div class="card">
                    <h3>Revision Distribution</h3>
                    <div class="chart-box">
                        <canvas id="revisionDistributionChart"></canvas>
                    </div>
                </div>
                <div class="card">
                    <h3>Delay Distribution</h3>
                    <div class="chart-box">
                        <canvas id="delayDistributionChart"></canvas>
                    </div>
                </div>
                <div class="card">
                    <h3>Estimation Accuracy Distribution</h3>
                    <div class="chart-box">
                        <canvas id="estimationDistributionChart"></canvas>
                    </div>
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
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3> Upcoming Deadlines </h3>
                </div>
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
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                        <h3>Top Performers</h3>
                    </div>
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
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                        <h3>Resource Utilization</h3>
                    </div>
                    <div class="chart-box">
                        <canvas id="utilizationChart"></canvas>
                    </div>
                </div>
            </div>
            <div class="chart-grid">
                <div class="card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                        <h3>Most Revised Tasks</h3>
                    </div>
                    <div class="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Task</th>
                                    <th>Project</th>
                                    <th>Iterations</th>
                                    <th>Revisions</th>
                                </tr>
                            </thead>

                            <tbody id="mostRevisedTasksBody">
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                        <h3>Most Revised Employees</h3>
                    </div>
                    <div class="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Employee</th>
                                    <th>Closed Tasks</th>
                                    <th>Avg Iterations</th>
                                    <th>Revision Rate</th>
                                </tr>
                            </thead>
                            <tbody id="mostRevisedEmployeesBody">
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            <div class="chart-grid">
                <div class="card">
                    <h3>Highest Rework Tasks</h3>
                    <div class="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Task</th>
                                    <th>Total Hours</th>
                                    <th>Rework Hours</th>
                                    <th>Rework %</th>
                                </tr>
                            </thead>
                            <tbody id="highestReworkTasksBody"> </tbody>
                        </table>
                    </div>
                </div>
            </div>
            <div class="chart-grid">
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                        <h3>Worst Estimated Tasks</h3>
                    </div>
                    <div class="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Task</th>
                                    <th>Estimated</th>
                                    <th>Actual</th>
                                    <th>Variance</th>
                                </tr>
                            </thead>
                            <tbody id="worstEstimatedTasksBody"> </tbody>
                        </table>
                    </div>
                </div>
                <div class="card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                        <h3>Worst Delayed Tasks</h3>
                    </div>
                    <div class="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Task</th>
                                    <th>Deadline</th>
                                    <th>Closed</th>
                                    <th>Delay</th>
                                </tr>
                            </thead>
                            <tbody id="worstDelayedTasksBody"> </tbody>
                        </table>
                    </div>
                </div>
            </div>
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3>Estimation Intelligence</h3>
                </div>
                <div class="table-wrapper">
                    <table>
                    <thead>
                        <tr>
                            <th>Employee</th>
                            <th>Tasks</th>
                            <th>Estimated</th>
                            <th>Actual</th>
                            <th>Variance</th>
                            <th>Accuracy</th>
                        </tr>
                    </thead>
                    <tbody id="estimationIntelligenceBody"> </tbody>
                    </table>
                </div>
            </div>
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3>Project Estimation Intelligence</h3>
                </div>
                <div class="table-wrapper">
                    <table>
                    <thead>
                        <tr>
                            <th>Project</th>
                            <th>Tasks</th>
                            <th>Estimated</th>
                            <th>Actual</th>
                            <th>Variance</th>
                            <th>Accuracy</th>
                        </tr>
                    </thead>
                    <tbody id="projectEstimationBody"> </tbody>
                    </table>
                </div>
            </div>
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3>Most Extended Tasks</h3>
                </div>
                <div class="table-wrapper">
                    <table>
                    <thead>
                        <tr>
                        <th>Task</th>
                        <th>Extensions</th>
                        <th>Current Deadline</th>
                        <th>Status</th>
                        </tr>
                    </thead>

                    <tbody id="mostExtendedTasksBody">
                    </tbody>
                    </table>
                </div>
            </div>
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3> Most Re Estimated Tasks </h3>
                </div>
                <div class="table-wrapper">
                    <table>
                    <thead>
                        <tr>
                        <th>Task</th>
                        <th>Changes</th>
                        <th>Original</th>
                        <th>Current</th>
                        <th>Growth</th>
                        </tr>
                    </thead>
                    <tbody id="reEstimatedTasksBody"> </tbody>
                    </table>
                </div>
            </div>
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3> Smart Insights </h3>
                </div>
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
        renderMostRevisedTasks(filteredTasks, projects);
        renderMostRevisedEmployees(filteredTasks, employees);
        renderHighestReworkTasks(closedTasksData, taskLogs, taskIterations);
        renderWorstEstimatedTasks(filteredTasks, taskLogs);
        renderWorstDelayedTasks(closedTasksData);
        renderUtilizationChart(filteredTasks, employees, taskLogs);
        generateSmartInsights(filteredTasks, employees);
        renderDepartmentChart(filteredTasks, employees);
        renderIterationDistributionChart(filteredTasks);
        renderRevisionDistributionChart(filteredTasks);
        renderDelayDistributionChart(closedTasksData);
        renderEstimationIntelligence(closedTasksData, employees, taskLogs);
        renderProjectEstimationIntelligence(closedTasksData, projects, taskLogs);
        renderEstimationDistributionChart(estimationBuckets);
        renderMostExtendedTasks(filteredTasks, deadlineHistory);
        renderMostReEstimatedTasks(filteredTasks, estimationHistory);
        hideLoader();
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
        .select("*,task_iterations(*)")
        .eq("assigned_to",employeeId);

        deriveIterationTaskStats(tasks);

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
        const totalIterations = closedTasks.reduce((sum, task) => sum + Number(task.planned_iteration_count || 0), 0);
        const firstPassTasks = closedTasks.filter(t => Number(t.revision_count || 0) === 0).length;
        const totalRevisions = closedTasks.reduce((sum, task) => sum + Number(task.revision_count || 0), 0);
        const avgIterations = closedTasks.length > 0 ? (totalIterations / closedTasks.length).toFixed(2) : 0;
        const firstPassRate = closedTasks.length > 0 ? Math.round((firstPassTasks / closedTasks.length) * 100) : 0;
        const revisionBurden = closedTasks.length > 0 ? (totalRevisions / closedTasks.length).toFixed(2) : 0;
        const qualityScore =Math.round((firstPassRate * 0.7) + ((100 - revisionBurden * 20) * 0.3));

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
                    <span>Avg Iterations</span>
                    <h2>${avgIterations}</h2>
                </div>
                <div class="dash-card">
                    <span>First Pass Rate</span>
                    <h2>${firstPassRate}%</h2>
                </div>
                <div class="dash-card">
                    <span>Revision Burden</span>
                    <h2>${revisionBurden}</h2>
                </div>
                <div class="dash-card">
                    <span>Quality Score</span>
                    <h2>${qualityScore}</h2>
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
        .select("*,task_iterations(*)")
        .eq("project_id",projectId);

        deriveIterationTaskStats(tasks);

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
        const totalIterations = closedTasks.reduce((sum, task) => sum + Number(task.planned_iteration_count || 0), 0);
        const totalRevisions = closedTasks.reduce((sum, task) => sum + Number(task.revision_count || 0), 0);
        const revisedTasks = closedTasks.filter(t => Number(t.revision_count || 0) > 0).length;
        const avgIterations = closedTasks.length > 0 ? (totalIterations / closedTasks.length).toFixed(2) : 0;
        const revisionRate = closedTasks.length > 0 ? Math.round((revisedTasks / closedTasks.length) * 100) : 0;
        const avgRevisions = closedTasks.length > 0 ? (totalRevisions / closedTasks.length).toFixed(2) : 0;
        const projectQualityScore = Math.max(0, Math.round(100 - revisionRate));
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
                <div class="dash-card">
                    <span>Avg Iterations</span>
                    <h2>${avgIterations}</h2>
                </div>
                <div class="dash-card">
                    <span>Revision Rate</span>
                    <h2>${revisionRate}%</h2>
                </div>
                <div class="dash-card">
                    <span>Avg Revisions</span>
                    <h2>${avgRevisions}</h2>
                </div>
                <div class="dash-card">
                    <span>Quality Score</span>
                    <h2>${projectQualityScore}</h2>
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

        const sortedDays = Object.keys(daily).sort((a,b) => new Date(a) - new Date(b));

        new Chart(document.getElementById("employeeTimelineChart"),
            {
            type:"line",

            data:{
                labels:sortedDays,

                datasets:[{
                label:"Tracked Hours",
                data:sortedDays.map(day => daily[day]),
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

            const allocatedHours = empTasks.reduce((sum,task)=> sum + Number(task.allotted_hours || 0), 0);
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

    function renderIterationDistributionChart(tasks){
        Chart.getChart("iterationDistributionChart")?.destroy();

        const distribution = {
            "1 Iteration": 0,
            "2 Iterations": 0,
            "3 Iterations": 0,
            "4+ Iterations": 0
        };

        tasks.filter(t => t.status?.toLowerCase() === "closed").forEach(task => {
            const iterations = Number(task.planned_iteration_count || 0);
            if(iterations === 1){
                distribution["1 Iteration"]++;
            }
            else if(iterations === 2){
                distribution["2 Iterations"]++;
            }
            else if(iterations === 3){
                distribution["3 Iterations"]++;
            }
            else{
                distribution["4+ Iterations"]++;
            }
        });

        new Chart(document.getElementById("iterationDistributionChart"),
            {
                type:"bar",
                data:{
                    labels:Object.keys(distribution),
                    datasets:[{
                        label:"Tasks",
                        data:Object.values(distribution)
                    }]
                }
            }
        );
    }

    function renderMostRevisedTasks(tasks, projects){
        const body = document.getElementById("mostRevisedTasksBody");

        if(!body){
            return;
        }

        body.innerHTML = "";
        const ranking = tasks.filter(t => Number(t.revision_count || 0) > 0).sort((a,b) => Number(b.revision_count || 0) - Number(a.revision_count || 0)).slice(0,10);

        ranking.forEach(task => {
            const project = projects.find(p => String(p.id) === String(task.project_id));
            body.innerHTML += `
                <tr>
                    <td>${task.title}</td>
                    <td>${project?.name || "-"}</td>
                    <td>
                        ${Number(task.planned_iteration_count || 0)}
                    </td>
                    <td>
                        ${task.revision_count || 0}
                    </td>
                </tr>
            `;
        });
    }

    function renderMostRevisedEmployees(tasks, employees){
        const body = document.getElementById("mostRevisedEmployeesBody");

        if(!body){
            return;
        }

        body.innerHTML = "";

        const stats = {};

        employees.forEach(emp => {
            stats[String(emp.id)] = {
                id: emp.id,
                name: emp.name,
                closedTasks: 0,
                totalIterations: 0,
                revisedTasks: 0
            };

        });

        tasks.filter(t => t.status?.toLowerCase() === "closed").forEach(task => {
            const empId = String(task.assigned_to);

            if(!stats[empId]){
                return;
            }

            stats[empId].closedTasks++;

            const revisions = Number(task.revision_count || 0);
            stats[empId].totalIterations += Number(task.planned_iteration_count || 0);

            if(revisions > 0){
                stats[empId].revisedTasks++;
            }
        });

        const ranking = Object.values(stats).filter(emp => emp.closedTasks > 0).map(emp => {
                const avgIterations = emp.totalIterations / emp.closedTasks;
                const revisionRate = Math.round((emp.revisedTasks / emp.closedTasks) * 100);
                return {...emp, avgIterations, revisionRate};
            }).sort((a,b) => b.avgIterations - a.avgIterations).slice(0,10);

        ranking.forEach(emp => {
            body.innerHTML += `
                <tr>
                    <td>${emp.name}</td>
                    <td>${emp.closedTasks}</td>
                    <td>
                        ${emp.avgIterations.toFixed(2)}
                    </td>
                    <td>
                        ${emp.revisionRate}%
                    </td>
                </tr>
            `;
        });
    }

    function renderRevisionDistributionChart(tasks){
        Chart.getChart("revisionDistributionChart") ?.destroy();

        const distribution = {
            "0":0,
            "1":0,
            "2":0,
            "3":0,
            "4+":0
        };

        tasks.filter(t => t.status?.toLowerCase() === "closed").forEach(task => {
            const revisions = Number(task.revision_count || 0);
            if(revisions === 0){
                distribution["0"]++;
            }
            else if(revisions === 1){
                distribution["1"]++;
            }
            else if(revisions === 2){
                distribution["2"]++;
            }
            else if(revisions === 3){
                distribution["3"]++;
            }
            else{
                distribution["4+"]++;
            }
        });

        new Chart(document.getElementById("revisionDistributionChart"),
            {
                type:"bar",
                data:{
                    labels: Object.keys(distribution),
                    datasets:[
                        {
                            label: "Tasks",
                            data: Object.values(distribution)
                        }
                    ]
                }
            }
        );
    }

    function renderWorstEstimatedTasks(tasks, taskLogs){
        const body = document.getElementById("worstEstimatedTasksBody");

        if(!body){
            return;
        }

        body.innerHTML = "";

        const taskActualMap = {};

        taskLogs.forEach(log => {
            const taskId = String(log.task_id);

            if(!taskActualMap[taskId]){
                taskActualMap[taskId] = 0;
            }

            taskActualMap[taskId] += Number(log.duration || 0) / 3600;
        });

        const ranking = tasks.filter(t => t.status?.toLowerCase() === "closed").map(task => {
            const estimated = Number(task.allotted_hours || 0);
            const actual = Number(taskActualMap[String(task.id)] || 0);
            return {
                task,
                estimated,
                actual,
                variance: actual - estimated
            };
        }).sort((a,b) => b.variance - a.variance) .slice(0,10);

        ranking.forEach(item => {
            body.innerHTML += `
                <tr>
                    <td> ${item.task.title} </td>
                    <td> ${item.estimated.toFixed(1)}h </td>
                    <td> ${item.actual.toFixed(1)}h </td>
                    <td> ${item.variance.toFixed(1)}h </td>
                </tr>
            `;
        });
    }

    function renderDelayDistributionChart(tasks){
        Chart.getChart("delayDistributionChart") ?.destroy();

        const distribution = {
            "On Time":0,
            "1-3 Days":0,
            "4-7 Days":0,
            "8-14 Days":0,
            "15+ Days":0
        };

        tasks.forEach(task => {
            if(!task.deadline || !task.closed_at){
                return;
            }

            const deadline = new Date(task.deadline);
            const closedAt = new Date(task.closed_at);
            const delay = Math.ceil((closedAt - deadline) / (1000 * 60 * 60 * 24));

            if(delay <= 0){
                distribution["On Time"]++;
            }
            else if(delay <= 3){
                distribution["1-3 Days"]++;
            }
            else if(delay <= 7){
                distribution["4-7 Days"]++;
            }
            else if(delay <= 14){
                distribution["8-14 Days"]++;
            }
            else{
                distribution["15+ Days"]++;
            }
        });

        new Chart(document.getElementById("delayDistributionChart"),
            {
                type:"bar",
                data:{
                    labels: Object.keys(distribution),
                    datasets:[
                        {
                            label: "Tasks",
                            data: Object.values(distribution)
                        }
                    ]
                }
            }
        );
    }

    function renderWorstDelayedTasks(tasks){
        const body = document.getElementById("worstDelayedTasksBody");

        if(!body){
            return;
        }

        body.innerHTML = "";

        const ranking = tasks.filter(t => t.deadline && t.closed_at).map(task => {
                const delay = Math.ceil((new Date(task.closed_at) - new Date(task.deadline)) / (1000 * 60 * 60 * 24));

                return {
                    task,
                    delay
                };
            }).filter(item => item.delay > 0).sort((a,b) => b.delay - a.delay).slice(0,10);

        ranking.forEach(item => {
            body.innerHTML += `
                <tr>
                    <td> ${item.task.title} </td>
                    <td> ${item.task.deadline} </td>
                    <td> ${item.task.closed_at ? item.task.closed_at.split("T")[0] : "-"} </td>
                    <td> ${item.delay}d </td>
                </tr>
            `;
        });
    }

    function renderHighestReworkTasks(tasks, taskLogs, taskIterations){
        const body = document.getElementById("highestReworkTasksBody");

        if(!body){
            return;
        }

        body.innerHTML = "";

        const ranking = [];

        tasks.forEach(task => {
            const iterations = taskIterations.filter(i => String(i.task_id) === String(task.id)).sort((a,b) => a.iteration_no - b.iteration_no);

            if(iterations.length <= 1){
                return;
            }

            let totalHours = 0;
            let firstHours = 0;

            iterations.forEach((iteration,index) => {
                const hours = taskLogs.filter(log => String(log.iteration_id) === String(iteration.id)).reduce((sum,log) => sum + (Number(log.duration || 0) / 3600), 0);

                totalHours += hours;

                if(index === 0){
                    firstHours = hours;
                }
            });

            const rework = totalHours - firstHours;
            const percent = totalHours > 0 ? (rework / totalHours) * 100 : 0;

            ranking.push({
                task,
                totalHours,
                rework,
                percent
            });
        });

        ranking.sort((a,b) => b.percent - a.percent).slice(0,10).forEach(item => {
            body.innerHTML += `
                <tr>
                    <td> ${item.task.title} </td>
                    <td> ${item.totalHours.toFixed(1)}h </td>
                    <td> ${item.rework.toFixed(1)}h </td>
                    <td> ${item.percent.toFixed(0)}% </td>
                </tr>
            `;
        });
    }

    function renderEstimationIntelligence(tasks, employees, taskLogs){
        const body = document.getElementById("estimationIntelligenceBody");

        if(!body){
            return;
        }

        body.innerHTML = "";
        const employeeStats = {};

        employees.forEach(emp => {
            employeeStats[String(emp.id)] = {
            employee: emp,
            tasks: 0,
            estimated: 0,
            actual: 0
            };
        });

        tasks.forEach(task => {
            const employeeId = String(task.assigned_to);

            if(!employeeStats[employeeId]){
            return;
            }

            const estimated = Number(task.allotted_hours || 0);
            const actual = taskLogs.filter(log => String(log.task_id) === String(task.id)).reduce((sum,log)=> sum + (Number(log.duration || 0) / 3600), 0);

            employeeStats[employeeId].tasks++;
            employeeStats[employeeId].estimated += estimated;
            employeeStats[employeeId].actual += actual;
        });

        const rows = Object.values(employeeStats).filter(x => x.tasks > 0).map(stat => {
            const variance = stat.actual - stat.estimated;
            let accuracy = 100;

            if(stat.estimated > 0){
                const variancePercent = (Math.abs(variance) / stat.estimated) * 100;
                accuracy = Math.max(0, Math.round(100 - variancePercent));
            }

            return {
                ...stat,
                variance,
                accuracy
            };
            }).sort((a,b)=> b.accuracy - a.accuracy);

        rows.forEach(row => {
            body.innerHTML += `
            <tr>
                <td> ${row.employee.name} </td>
                <td> ${row.tasks} </td>
                <td> ${row.estimated.toFixed(1)} </td>
                <td> ${row.actual.toFixed(1)} </td>
                <td> ${row.variance.toFixed(1)} </td>
                <td> ${row.accuracy}% </td>
            </tr>
            `;
        });
    }

    function renderProjectEstimationIntelligence(tasks, projects, taskLogs){
        const body = document.getElementById("projectEstimationBody");

        if(!body){
            return;
        }

        body.innerHTML = "";
        const stats = {};

        projects.forEach(project => {
            stats[String(project.id)] = {
            project,
            tasks:0,
            estimated:0,
            actual:0
            };
        });

        tasks.forEach(task => {
            const projectId = String(task.project_id);

            if(!stats[projectId]){
            return;
            }

            const estimated = Number(task.allotted_hours || 0);
            const actual = taskLogs.filter(log => String(log.task_id) === String(task.id)).reduce((sum,log)=> sum + (Number(log.duration || 0) / 3600), 0);

            stats[projectId].tasks++;
            stats[projectId].estimated += estimated;
            stats[projectId].actual += actual;
        });

        Object.values(stats).filter(x => x.tasks > 0).forEach(row => {
            const variance = row.actual - row.estimated;
            const accuracy = row.estimated > 0 ? Math.max(0, Math.round(100 - (Math.abs(variance) / row.estimated) * 100)) : 100;

            body.innerHTML += `
            <tr>
                <td>${row.project.name}</td>
                <td>${row.tasks}</td>
                <td>${row.estimated.toFixed(1)}</td>
                <td>${row.actual.toFixed(1)}</td>
                <td>${variance.toFixed(1)}</td>
                <td>${accuracy}%</td>
            </tr>
            `;
        });
    }

    function renderEstimationDistributionChart(buckets){
        const canvas = document.getElementById("estimationDistributionChart");

        if(!canvas){
            return;
        }

         Chart.getChart("estimationDistributionChart")?.destroy();

        new Chart(document.getElementById("estimationDistributionChart"),{
            type:"bar",
            data:
            {
                labels:["90%+", "70-89%", "50-69%", "<50%"],
                datasets:[{
                data:[
                        buckets.excellent,
                        buckets.good,
                        buckets.average,
                        buckets.poor
                    ]
                }]
            },
            options:
            {
                    responsive:true,
                    plugins:{
                    legend:{
                        display:false
                    }
                    }
            }
        });
    }

    function renderMostExtendedTasks(tasks, deadlineHistory){
        const body = document.getElementById("mostExtendedTasksBody");

        if(!body){
            return;
        }

        body.innerHTML = "";

        const taskCounts = {};

        deadlineHistory.forEach(h => {
            const taskId = String(h.task_id);

            if(!taskCounts[taskId]){
            taskCounts[taskId] = 0;
            }

            taskCounts[taskId]++;
        });

        Object.entries(taskCounts).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([taskId,count])=>{
            const task = tasks.find(t => String(t.id) === taskId);

            if(!task){
            return;
            }

            body.innerHTML += `
            <tr>
                <td>${task.title}</td>
                <td>${count}</td>
                <td>${task.deadline || "-"}</td>
                <td>${task.status}</td>
            </tr>
            `;
        });
    }

    function renderMostReEstimatedTasks(tasks, estimationHistory){
        const body = document.getElementById("reEstimatedTasksBody");

        if(!body){
            return;
        }

        body.innerHTML = "";

        const counts = {};

        estimationHistory.forEach(h => {
            const taskId = String(h.task_id);

            if(!counts[taskId]){
            counts[taskId] = 0;
            }

            counts[taskId]++;

        });

        Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([taskId,count])=>{
            const task = tasks.find(t => String(t.id) === taskId);

            if(!task){
                return;
            }

            const original = Number(task.original_allotted_hours || task.allotted_hours || 0);
            const current = Number(task.allotted_hours || 0);
            const growth = original > 0 ? Math.round(((current - original) / original) * 100) : 0;

            body.innerHTML += `
            <tr>
                <td> ${task.title} </td>
                <td> ${count} </td>
                <td> ${original} </td>
                <td> ${current} </td>
                <td> ${growth}% </td>
            </tr>
            `;
        });
    }
