(function(){
  const IW = window.IterationWorkflow;

  window.addAdminIterationRow = function(values={}){
    IW.addPlanRow("adminIterationPlan", values);
  };

  window.openTaskModal = async function(){
    const [{data:projects}, {data:employees}] = await Promise.all([
      db.from("projects").select("id,name").eq("status","active").order("name"),
      db.from("employees").select("id,name").eq("status","active").order("name")
    ]);
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.style.display = "flex";
    modal.innerHTML = `
      <div class="modal-content" style="max-width:950px">
        <h3>Create Task & Iteration Plan</h3>
        <div class="form-grid">
          <div class="form-field"><label>Project</label><select class="input-field" id="taskProject">${(projects||[]).map(p=>`<option value="${p.id}">${IW.escapeHtml(p.name)}</option>`).join("")}</select></div>
          <div class="form-field"><label>Assign Employee</label><select class="input-field" id="taskEmployee">${(employees||[]).map(e=>`<option value="${e.id}">${IW.escapeHtml(e.name)}</option>`).join("")}</select></div>
          <div class="form-field"><label>Task Title</label><input class="input-field" id="taskTitle"></div>
        </div>
        <div class="form-field"><label>Task Description</label><textarea id="taskDesc" class="input-field" style="width:100%;min-height:80px"></textarea></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin:18px 0 10px">
          <h4 style="margin:0">Planned Iterations</h4>
          <button type="button" onclick="addAdminIterationRow()">Add Iteration</button>
        </div>
        <div id="adminIterationPlan"></div>
        <div class="modal-actions">
          <button onclick="createTask(this)">Create Task</button>
          <button class="secondary-btn" onclick="this.closest('.modal').remove()">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    addAdminIterationRow();
  };

  window.createTask = async function(btn){
    const projectId = document.getElementById("taskProject").value;
    const employeeId = document.getElementById("taskEmployee").value;
    const title = document.getElementById("taskTitle").value.trim();
    const iterations = IW.collectIterationRows("adminIterationPlan");
    console.log(iterations);
    console.log(JSON.stringify(iterations, null, 2));
    const planError = IW.validatePlan(iterations);
    if(!projectId || !employeeId || !title || planError){
      showToast(planError || "Project, employee and task title are required", "error");
      return;
    }
    btn.disabled = true;
    showLoader("Creating task plan...");
    let taskId = null;
    try{
      const empId = await getEmployeeId();
      const totalHours = iterations.reduce((sum,i)=>sum+i.allotted_hours,0);
      const finalDeadline = iterations.at(-1).deadline;
      const {data:task,error:taskError} = await db.from("tasks").insert({
        project_id:projectId, title, description:document.getElementById("taskDesc").value.trim(),
        assigned_to:employeeId, assigned_by:empId, status:"pending", approval_status:"approved",
        approved_by:empId, approved_at:new Date().toISOString(), current_iteration_no:1,
        allotted_hours:totalHours, original_allotted_hours:totalHours,
        deadline:finalDeadline, original_deadline:finalDeadline, revision_count:0
      }).select("id").single();
      if(taskError) throw taskError;
      taskId = task.id;
      console.log(iterations);
      const {error:iterationError} = await db.from("task_iterations").insert(iterations.map(i=>({
        ...i, task_id:task.id, status:"planned", created_by:empId
      })));
      if(iterationError) throw iterationError;
      await createNotification(employeeId,"New Task Assigned",`You have been assigned "${title}" with ${iterations.length} planned iterations`,"task_assigned","task",task.id);
      hideLoader();
      btn.closest(".modal").remove();
      showToast("Task and iteration plan created", "success");
      renderTasksPage();
    }catch(err){
      if(taskId) await db.from("tasks").delete().eq("id",taskId);
      hideLoader();
      btn.disabled = false;
      showToast(err.message || String(err), "error");
    }
  };

  window.loadTasks = async function(){
    const status = document.getElementById("taskStatusFilter")?.value || "all";
    const employee = document.getElementById("taskEmployeeFilter")?.value || "all";
    const project = document.getElementById("taskProjectFilter")?.value || "all";
    const from = document.getElementById("taskFromDeadlineFilter")?.value;
    const to = document.getElementById("taskToDeadlineFilter")?.value;
    let query = db.from("tasks").select(`*,projects!tasks_project_id_fkey(name),assignee:employees!tasks_assigned_to_fkey(name),assigner:employees!tasks_assigned_by_fkey(name),task_iterations(*,task_logs(duration))`).order("created_at",{ascending:false});
    if(status !== "all") query = query.eq("status",status);
    if(employee !== "all") query = query.eq("assigned_to",employee);
    if(project !== "all") query = query.eq("project_id",project);
    const {data,error} = await query;
    if(error){ showToast(error.message,"error"); return; }
    const tasks = (data||[]).filter(task=>{
      const deadline = IW.taskStats(task).finalDeadline;
      return (!from || (deadline && deadline >= from)) && (!to || (deadline && deadline <= to));
    });
    const body = document.querySelector("#taskTable tbody");
    if(!body) return;
    body.innerHTML = tasks.map(task=>{
      const stats = IW.taskStats(task);
      return `<tr>
        <td>${IW.escapeHtml(task.title)}</td><td>${IW.escapeHtml(task.projects?.name||"-")}</td>
        <td>${IW.escapeHtml(task.assignee?.name||"-")}</td><td>${IW.escapeHtml(task.assigner?.name||"-")}</td>
        <td><span class="badge ${task.status === "closed" || task.status === "submitted" ? "badge-good" : task.status === "in_progress" || task.status === "review" ? "badge-pending" : "badge-bad"}">${IW.escapeHtml(task.status)}</span></td>
        <td><span class="badge ${task.approval_status === "approved" ? "badge-good" : "badge-pending"}">${IW.escapeHtml(task.approval_status||"approved")}</span></td>
        <td>${stats.allocatedHours} hrs / ${IW.duration(stats.trackedSeconds)}</td>
        <td>${stats.finalDeadline||"-"}<br><small>${stats.onTime} on time · ${stats.breached} breached</small></td>
        <td>
              ${task.status === "review" ? `
                <button onclick="openTaskDetails('${task.id}')"> View Stats </button>
                <button onclick="closeTask('${task.id}')"> Mark Closed </button>
              ` : task.status !== "closed" ? `
                <button onclick="openTaskDetails('${task.id}')"> View Stats </button>
                <button onclick="openEditTaskModal('${task.id}')"> Edit </button>
                <button class="danger-btn" onclick="deleteTask('${task.id}',this)"> Delete </button>` : `<button onclick="openTaskDetails('${task.id}')"> View Stats </button>`}
            </td>
      </tr>`;
    }).join("");
  };

  window.openTaskDetails = async function(taskId){
    showLoader("Loading iteration stats...");
    const {data:task,error} = await db.from("tasks").select(`*,projects(name),assignee:employees!tasks_assigned_to_fkey(id,name),assigner:employees!tasks_assigned_by_fkey(id,name),task_iterations(*,reviewer:employees!task_iterations_reviewed_by_fkey(name),task_logs(duration),task_iteration_revisions(*)),task_comments(*,employee:employees(name))`).eq("id",taskId).single();
    hideLoader();
    if(error){ showToast(error.message,"error"); return; }
    renderTaskDetailsModal(task);
  };

  window.renderTaskDetailsModal = function(task){
    const stats = IW.taskStats(task);
    const modal = document.createElement("div");
    modal.className = "modal task-details-modal";
    modal.style.display = "flex";
    modal.innerHTML = `<div class="modal-content" style="max-width:1100px">
      <h3>${IW.escapeHtml(task.title)}</h3>
      <div class="form-grid">
        <div><strong>Status</strong><div>${IW.escapeHtml(task.status)}</div></div>
        <div><strong>Iterations</strong><div>${stats.completed}/${stats.iterations.length} complete</div></div>
        <div><strong>Allocated</strong><div>${stats.allocatedHours}h</div></div>
        <div><strong>Tracked</strong><div>${IW.duration(stats.trackedSeconds)}</div></div>
        <div><strong>Deadline result</strong><div>${stats.onTime} on time / ${stats.breached} breached</div></div>
        <div><strong>Revisions</strong><div>${stats.revisions}</div></div>
        ${task.approval_status === "pending" ? `
          <div class="card" style="margin-top:15px;margin-bottom:15px;">
            <h4>Task Approval Required</h4>
            <p> This task is currently awaiting approval. </p>
            <div style="display:flex;gap:10px;margin-top:10px;">
              <button class="success-btn" onclick="approveTask('${task.id}')">
                Approve Task
              </button>
              <button class="danger-btn" onclick="rejectTask('${task.id}')">
                Reject Task
              </button>
            </div>
          </div>` : ""}
      </div><hr><h4>Iteration Performance</h4>
      ${stats.iterations.map(i=>`<div class="card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;gap:12px"><h4>#${i.iteration_no} ${IW.escapeHtml(i.title||"")}</h4><span class="badge ${i.status === "approved" ? "badge-good" : i.status === "submitted" ? "badge-pending" : "badge-bad"}">${IW.escapeHtml(i.status)}</span></div>
        <p>${IW.escapeHtml(i.description||"")}</p>
        <div class="form-grid">
          <div><strong>Allocated</strong><div>${Number(i.allotted_hours||0)}h</div></div>
          <div><strong>Tracked</strong><div>${IW.duration(i.trackedSeconds)}</div></div>
          <div><strong>Deadline</strong><div>${i.deadline||"-"}</div></div>
          <div><strong>Submitted</strong><div>${i.submitted_at ? new Date(i.submitted_at).toLocaleString() : "-"}</div></div>
          <div><strong>Deadline status</strong><div>${i.onTime === null ? "Pending" : i.onTime ? "On time" : "Breached"}</div></div>
          <div><strong>Revisions</strong><div>${Number(i.revision_count||0)}</div></div>
        </div>
        <div><strong>Revision reasons</strong>${IW.revisionHtml(i)}</div>
        ${i.status === "submitted" ? `<div style="margin-top:10px"><button onclick="approveIteration('${i.id}','${task.id}')">Approve</button> <button class="danger-btn" onclick="requestRevision('${i.id}','${task.id}')">Request Revision</button></div>` : ""}
      </div>`).join("")}
      ${task.status === "submitted" ? `<button onclick="closeTask('${task.id}')">Close Completed Task</button>` : ""}
      <div class="modal-actions"><button class="secondary-btn" onclick="this.closest('.modal').remove()">Close</button></div>
    </div>`;
    document.body.appendChild(modal);
  };

  window.approveIteration = async function(iterationId,taskId){
    showLoader("Approving iteration...");
    try{
      const reviewer = await getEmployeeId();
      const now = new Date().toISOString();
      const {error} = await db.from("task_iterations").update({status:"approved",reviewed_at:now,approved_at:now,reviewed_by:reviewer}).eq("id",iterationId);
      if(error) throw error;
      await db.from("task_iteration_revisions").update({resolved_at:now}).eq("iteration_id",iterationId).is("resolved_at",null);
      const {data:iterations,error:loadError} = await db.from("task_iterations").select("id,iteration_no,status").eq("task_id",taskId).order("iteration_no");
      if(loadError) throw loadError;
      const next = iterations.find(i=>i.status !== "approved");
      const taskUpdate = next ? {status:"pending",current_iteration_no:next.iteration_no,next_verification_at:null} : {status:"submitted",reviewed_at:now,reviewed_by:reviewer,next_verification_at:null};
      await db.from("tasks").update(taskUpdate).eq("id",taskId);
      const {data:task} = await db.from("tasks").select("title,assigned_to").eq("id",taskId).single();
      await createNotification(task.assigned_to,"Iteration Approved",next ? `Next iteration is ready for \"${task.title}\"` : `All iterations completed for \"${task.title}\"`,"iteration_approved","task",taskId);
      hideLoader(); document.querySelector(".task-details-modal")?.remove();
      showToast(next ? "Iteration approved; next iteration unlocked" : "All iterations approved; task submitted", "success");
      openTaskDetails(taskId); loadTasks();
    }catch(err){ hideLoader(); showToast(err.message||String(err),"error"); }
  };

  window.requestRevision = async function(iterationId,taskId){
    const reason = prompt("Enter revision reason");
    if(!reason?.trim()) return;
    showLoader("Requesting revision...");
    try{
      const reviewer = await getEmployeeId();
      const {data:iteration,error:readError} = await db.from("task_iterations").select("revision_count").eq("id",iterationId).single();
      if(readError) throw readError;
      const revisionNo = Number(iteration.revision_count||0)+1;
      const {error:revisionError} = await db.from("task_iteration_revisions").insert({iteration_id:iterationId,task_id:taskId,revision_no:revisionNo,reason:reason.trim(),requested_by:reviewer});
      if(revisionError) throw revisionError;
      await db.from("task_iterations").update({status:"revision_requested",revision_count:revisionNo,review_notes:reason.trim(),reviewed_by:reviewer,reviewed_at:new Date().toISOString()}).eq("id",iterationId);
      const {data:task} = await db.from("tasks").select("title,assigned_to").eq("id",taskId).single();
      const {data:taskIterations} = await db.from("task_iterations").select("revision_count").eq("task_id",taskId);
      const taskRevisionCount = (taskIterations||[]).reduce((sum,item)=>sum + Number(item.revision_count||0),0);
      await db.from("tasks").update({status:"pending",next_verification_at:null,revision_count:taskRevisionCount}).eq("id",taskId);
      await createNotification(task.assigned_to,"Revision Requested",`Revision ${revisionNo} requested for \"${task.title}\": ${reason.trim()}`,"iteration_revision_requested","task",taskId);
      hideLoader(); document.querySelector(".task-details-modal")?.remove(); showToast("Revision requested on the same iteration","success"); openTaskDetails(taskId); loadTasks();
    }catch(err){ hideLoader(); showToast(err.message||String(err),"error"); }
  };

  const originalCloseTask = window.closeTask;
  window.closeTask = async function(taskId){
    const {data:iterations,error} = await db.from("task_iterations").select("status").eq("task_id",taskId);
    if(error){ showToast(error.message,"error"); return; }
    if(!iterations?.length || iterations.some(i=>i.status !== "approved")){
      showToast("Task cannot close until every iteration is approved","error"); return;
    }
    return originalCloseTask(taskId);
  };
})();
