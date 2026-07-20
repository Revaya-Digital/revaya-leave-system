(function(){
  const IW = window.IterationWorkflow;

  window.addEmployeeIterationRow = function(values={}){ IW.addPlanRow("employeeIterationPlan",values); };

  window.openEmployeeTaskModal = async function(){
    const empId = await getEmployeeId();
    const [{data:employees},{data:projects}] = await Promise.all([
      db.from("employees").select("id,name").or(`manager_id.eq.${empId},id.eq.${empId}`).order("name"),
      db.from("projects").select("id,name").eq("status","active").order("name")
    ]);
    const modal = document.createElement("div");
    modal.className="modal"; modal.style.display="flex";
    modal.innerHTML=`<div class="modal-content" style="max-width:950px">
      <h3>Create Task & Iteration Plan</h3>
      <div class="form-grid">
        <div class="form-field"><label>Project</label><select id="empTaskProject" class="input-field">${(projects||[]).map(p=>`<option value="${p.id}">${IW.escapeHtml(p.name)}</option>`).join("")}</select></div>
        <div class="form-field"><label>Assign To</label><select id="empTaskAssign" class="input-field">${(employees||[]).map(e=>`<option value="${e.id}">${IW.escapeHtml(e.name)}</option>`).join("")}</select></div>
        <div class="form-field"><label>Task Title</label><input id="empTaskTitle" class="input-field"></div>
      </div>
      <div class="form-field"><label>Task Description</label><textarea id="empTaskDesc" class="input-field" style="width:100%;min-height:80px"></textarea></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin:18px 0 10px"><h4 style="margin:0">Planned Iterations</h4><button type="button" onclick="addEmployeeIterationRow()">Add Iteration</button></div>
      <div id="employeeIterationPlan"></div>
      <div class="modal-actions"><button onclick="createEmployeeTask(this)">Create Task</button><button class="secondary-btn" onclick="this.closest('.modal').remove()">Cancel</button></div>
    </div>`;
    document.body.appendChild(modal); addEmployeeIterationRow();
  };

  window.createEmployeeTask = async function(btn){
    const empId = await getEmployeeId();
    const assignedTo = document.getElementById("empTaskAssign").value;
    const title = document.getElementById("empTaskTitle").value.trim();
    const iterations = IW.collectIterationRows("employeeIterationPlan");
    const planError = IW.validatePlan(iterations);
    if(!title || planError){ showToast(planError||"Task title is required","error"); return; }
    btn.disabled=true; showLoader("Creating task plan...");
    let taskId=null;
    try{
      const totalHours=iterations.reduce((sum,i)=>sum+i.allotted_hours,0);
      const finalDeadline=iterations.at(-1).deadline;
      const selfCreated=String(assignedTo)===String(empId);
      const {data:task,error:taskError}=await db.from("tasks").insert({
        project_id:document.getElementById("empTaskProject").value,assigned_to:assignedTo,assigned_by:empId,
        title,description:document.getElementById("empTaskDesc").value.trim(),status:"pending",
        approval_status:selfCreated?"pending":"approved",approved_by:selfCreated?null:empId,approved_at:selfCreated?null:new Date().toISOString(),
        current_iteration_no:1,allotted_hours:totalHours,original_allotted_hours:totalHours,deadline:finalDeadline,original_deadline:finalDeadline,revision_count:0
      }).select("id").single();
      if(taskError) throw taskError; taskId=task.id;
      const {error:iterationError}=await db.from("task_iterations").insert(iterations.map(i=>({...i,task_id:task.id,status:"planned",created_by:empId})));
      if(iterationError) throw iterationError;
      await createNotification(assignedTo,"Task Created",`Task \"${title}\" has ${iterations.length} planned iterations`,"task_assigned","task",task.id);
      hideLoader(); btn.closest(".modal").remove(); showToast("Task and iterations created","success"); loadTeamTasks();
    }catch(err){ if(taskId) await db.from("tasks").delete().eq("id",taskId); hideLoader(); btn.disabled=false; showToast(err.message||String(err),"error"); }
  };

  window.loadMyTasks = async function(){
    const empId=await getEmployeeId();
    const {data,error}=await db.from("tasks").select(`*,projects(name),task_iterations(*,task_logs(duration))`).eq("assigned_to",empId).order("created_at",{ascending:false});
    if(error){showToast(error.message,"error");return;}
    const body=document.getElementById("taskTable"); if(!body)return;
    body.innerHTML=(data||[]).map(task=>{
      const stats=IW.taskStats(task);
      const current=stats.iterations.find(i=>Number(i.iteration_no)===Number(task.current_iteration_no)) || stats.iterations.find(i=>i.status!=="approved");
      let action=`<button onclick="openTaskDetails('${task.id}')">View</button>`;
      if(task.approval_status==="pending") action=`<span class="badge badge-pending">Waiting Approval</span> ${action}`;
      else if(task.approval_status==="rejected") action=`<span class="badge badge-bad">Rejected</span>`;
      else if(task.status==="submitted" || task.status==="closed") action=`<span class="badge badge-good">${task.status}</span> ${action}`;
      else if(current?.status==="submitted") action=`<span class="badge badge-pending">Iteration in review</span> ${action}`;
      else if(task.status==="in_progress") action=`<button class="danger-btn" onclick="stopTask('${task.id}')">Stop</button> <button class="success-btn" onclick="submitIteration('${task.id}')">Submit Iteration</button> ${action}`;
      else if(current) action=`<button onclick="startTask('${task.id}')">Start Iteration ${current.iteration_no}</button> ${action}`;
      return `<tr><td>${IW.escapeHtml(task.title)}<br><small>${stats.completed}/${stats.iterations.length} iterations</small></td><td>${IW.escapeHtml(task.projects?.name||"-")}</td>
        <td><span class="badge ${task.status==="submitted"||task.status==="closed"?"badge-good":task.status==="in_progress"||task.status==="review"?"badge-pending":"badge-bad"}">${IW.escapeHtml(task.status)}</span></td>
        <td>${current?.deadline||stats.finalDeadline||"-"}<br><small>${stats.onTime} on time · ${stats.breached} breached</small></td>
        <td>${stats.allocatedHours}h</td><td>${IW.duration(stats.trackedSeconds)}</td><td>${action}</td></tr>`;
    }).join("");
  };

  window.startTask = async function(taskId){
    showLoader("Starting iteration...");
    try{
      const empId=await getEmployeeId();
      const {data:active}=await db.from("task_logs").select("id").eq("employee_id",empId).is("end_time",null);
      if(active?.length) throw new Error("Finish the active iteration first");
      const {data:task,error}=await db.from("tasks").select(`approval_status,current_iteration_no,task_iterations(*)`).eq("id",taskId).single();
      if(error)throw error; if(task.approval_status!=="approved")throw new Error("Task approval required");
      const current=(task.task_iterations||[]).find(i=>Number(i.iteration_no)===Number(task.current_iteration_no));
      if(!current||!["planned","revision_requested","in_progress"].includes(current.status))throw new Error("No iteration is ready to start");
      const now=new Date().toISOString();
      await db.from("task_logs").insert({task_id:taskId,iteration_id:current.id,employee_id:empId,start_time:now,revision_no:Number(current.revision_count||0)});
      await db.from("task_iterations").update({status:"in_progress",started_at:current.started_at||now}).eq("id",current.id);
      await db.from("tasks").update({status:"in_progress",next_verification_at:generateNextVerificationTime()}).eq("id",taskId);
      hideLoader();showToast(`Iteration ${current.iteration_no} started`,"success");loadMyTasks();
    }catch(err){hideLoader();showToast(err.message||String(err),"error");}
  };

  window.stopTask = async function(taskId){
    showLoader("Stopping iteration...");
    try{
      const empId=await getEmployeeId();
      const {data:log,error}=await db.from("task_logs").select("*").eq("task_id",taskId).eq("employee_id",empId).is("end_time",null).single();
      if(error)throw error;
      const now=new Date(); const duration=Math.floor((now-new Date(log.start_time))/1000);
      await db.from("task_logs").update({end_time:now.toISOString(),duration,stop_reason:"manual"}).eq("id",log.id);
      const {data:iteration}=await db.from("task_iterations").select("revision_count").eq("id",log.iteration_id).single();
      await db.from("task_iterations").update({status:Number(iteration?.revision_count||0)>0?"revision_requested":"planned"}).eq("id",log.iteration_id);
      await db.from("tasks").update({status:"pending",next_verification_at:null}).eq("id",taskId);
      hideLoader();showToast("Iteration paused","success");loadMyTasks();
    }catch(err){hideLoader();showToast(err.message||String(err),"error");}
  };

  window.submitIteration = async function(taskId){
    showLoader("Submitting iteration...");
    try{
      const empId=await getEmployeeId();
      const {data:task,error}=await db.from("tasks").select(`title,assigned_by,assigned_to,current_iteration_no,approval_status,task_iterations(*)`).eq("id",taskId).single();
      if(error)throw error;if(task.approval_status!=="approved")throw new Error("Task approval required");
      const current=(task.task_iterations||[]).find(i=>Number(i.iteration_no)===Number(task.current_iteration_no));
      if(!current||current.status!=="in_progress")throw new Error("Start the current iteration before submitting");
      const now=new Date();
      const {data:logs}=await db.from("task_logs").select("id,start_time").eq("task_id",taskId).eq("iteration_id",current.id).eq("employee_id",empId).is("end_time",null);
      for(const log of logs||[]) await db.from("task_logs").update({end_time:now.toISOString(),duration:Math.floor((now-new Date(log.start_time))/1000),stop_reason:"submitted"}).eq("id",log.id);
      await db.from("task_iterations").update({status:"submitted",submitted_at:now.toISOString()}).eq("id",current.id);
      await db.from("task_iteration_revisions").update({resubmitted_at:now.toISOString()}).eq("iteration_id",current.id).is("resubmitted_at",null);
      await db.from("tasks").update({status:"review",next_verification_at:null}).eq("id",taskId);
      await createNotification(task.assigned_by,"Iteration Submitted",`Iteration ${current.iteration_no} of \"${task.title}\" requires review`,"iteration_submitted","task",taskId);
      hideLoader();showToast("Iteration submitted for review","success");loadMyTasks();
    }catch(err){hideLoader();showToast(err.message||String(err),"error");}
  };

  window.openTaskDetails = async function(taskId){
    showLoader("Loading iteration stats...");
    const {data:task,error}=await db.from("tasks").select(`*,projects(name),assignee:employees!tasks_assigned_to_fkey(id,name),assigner:employees!tasks_assigned_by_fkey(id,name),task_iterations(*,reviewer:employees!task_iterations_reviewed_by_fkey(name),task_logs(duration),task_iteration_revisions(*)),task_comments(*,employee:employees(name))`).eq("id",taskId).single();
    hideLoader();if(error){showToast(error.message,"error");return;} task.canApprove=await canApproveTask(task); renderTaskDetailsModal(task);
  };

  window.renderTaskDetailsModal = function(task){
    const stats=IW.taskStats(task); const modal=document.createElement("div");modal.className="modal task-details-modal";modal.style.display="flex";
    modal.innerHTML=`<div class="modal-content" style="max-width:1050px"><h3>${IW.escapeHtml(task.title)}</h3>
      <div class="form-grid"><div><strong>Status</strong><div>${IW.escapeHtml(task.status)}</div></div><div><strong>Progress</strong><div>${stats.completed}/${stats.iterations.length}</div></div><div><strong>Allocated</strong><div>${stats.allocatedHours}h</div></div><div><strong>Tracked</strong><div>${IW.duration(stats.trackedSeconds)}</div></div><div><strong>On time / breached</strong><div>${stats.onTime} / ${stats.breached}</div></div><div><strong>Revisions</strong><div>${stats.revisions}</div></div></div><hr>
      ${task.approval_status==="pending"&&task.canApprove?`<button onclick="approveTask('${task.id}')">Approve Task Plan</button>`:""}
      <h4>Iteration Performance</h4>${stats.iterations.map(i=>`<div class="card" style="margin-bottom:12px"><h4>#${i.iteration_no} ${IW.escapeHtml(i.title||"")} — ${IW.escapeHtml(i.status)}</h4><p>${IW.escapeHtml(i.description||"")}</p>
        <div class="form-grid"><div><strong>Allocated</strong><div>${Number(i.allotted_hours||0)}h</div></div><div><strong>Tracked</strong><div>${IW.duration(i.trackedSeconds)}</div></div><div><strong>Deadline</strong><div>${i.deadline||"-"}</div></div><div><strong>Submitted</strong><div>${i.submitted_at?new Date(i.submitted_at).toLocaleString():"-"}</div></div><div><strong>Result</strong><div>${i.onTime===null?"Pending":i.onTime?"On time":"Breached"}</div></div><div><strong>Revisions</strong><div>${Number(i.revision_count||0)}</div></div></div>
        <div><strong>Revision reasons</strong>${IW.revisionHtml(i)}</div>${i.status==="submitted"&&task.canApprove?`<button onclick="approveIteration('${i.id}','${task.id}')">Approve</button> <button class="danger-btn" onclick="requestRevision('${i.id}','${task.id}')">Request Revision</button>`:""}</div>`).join("")}
      <div class="modal-actions"><button class="secondary-btn" onclick="this.closest('.modal').remove()">Close</button></div></div>`;document.body.appendChild(modal);
  };

  window.approveIteration = async function(iterationId,taskId){
    showLoader("Approving iteration...");
    try{
      const reviewer=await getEmployeeId();const now=new Date().toISOString();
      await db.from("task_iterations").update({status:"approved",reviewed_at:now,approved_at:now,reviewed_by:reviewer}).eq("id",iterationId);
      await db.from("task_iteration_revisions").update({resolved_at:now}).eq("iteration_id",iterationId).is("resolved_at",null);
      const {data:iterations}=await db.from("task_iterations").select("iteration_no,status").eq("task_id",taskId).order("iteration_no");
      const next=(iterations||[]).find(i=>i.status!=="approved");
      await db.from("tasks").update(next?{status:"pending",current_iteration_no:next.iteration_no,next_verification_at:null}:{status:"submitted",reviewed_at:now,reviewed_by:reviewer,next_verification_at:null}).eq("id",taskId);
      const {data:task}=await db.from("tasks").select("title,assigned_to").eq("id",taskId).single();
      await createNotification(task.assigned_to,"Iteration Approved",next?`Iteration ${next.iteration_no} is now ready`:`All iterations of \"${task.title}\" are approved`,"iteration_approved","task",taskId);
      hideLoader();document.querySelector(".task-details-modal")?.remove();showToast(next?"Next iteration unlocked":"All iterations complete; task submitted","success");openTaskDetails(taskId);loadMyTasks();
    }catch(err){hideLoader();showToast(err.message||String(err),"error");}
  };

  window.requestRevision = async function(iterationId,taskId){
    const reason=prompt("Enter revision reason");if(!reason?.trim())return;showLoader("Requesting revision...");
    try{
      const reviewer=await getEmployeeId();const {data:i}=await db.from("task_iterations").select("revision_count").eq("id",iterationId).single();const revisionNo=Number(i?.revision_count||0)+1;
      await db.from("task_iteration_revisions").insert({iteration_id:iterationId,task_id:taskId,revision_no:revisionNo,reason:reason.trim(),requested_by:reviewer});
      await db.from("task_iterations").update({status:"revision_requested",revision_count:revisionNo,review_notes:reason.trim(),reviewed_by:reviewer,reviewed_at:new Date().toISOString()}).eq("id",iterationId);
      const {data:allIterations}=await db.from("task_iterations").select("revision_count").eq("task_id",taskId);const total=(allIterations||[]).reduce((sum,x)=>sum+Number(x.revision_count||0),0);
      const {data:task}=await db.from("tasks").select("title,assigned_to").eq("id",taskId).single();await db.from("tasks").update({status:"pending",revision_count:total,next_verification_at:null}).eq("id",taskId);
      await createNotification(task.assigned_to,"Revision Requested",`Revision ${revisionNo} requested: ${reason.trim()}`,"iteration_revision_requested","task",taskId);
      hideLoader();document.querySelector(".task-details-modal")?.remove();showToast("Revision requested on this iteration","success");openTaskDetails(taskId);loadMyTasks();
    }catch(err){hideLoader();showToast(err.message||String(err),"error");}
  };
})();
