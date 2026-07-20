(function(){
  function escapeHtml(value){
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function duration(seconds){
    const total = Math.max(0, Number(seconds || 0));
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = Math.floor(total % 60);
    return `${hrs}h ${mins}m ${secs}s`;
  }

  function normalizeIterations(task){
    return [...(task.task_iterations || [])]
      .sort((a,b)=>Number(a.iteration_no) - Number(b.iteration_no))
      .map(iteration => {
        const trackedSeconds = (iteration.task_logs || [])
          .reduce((sum, log)=>sum + Number(log.duration || 0), 0);
        const onTime = iteration.submitted_at && iteration.deadline
          ? new Date(iteration.submitted_at).getTime() <= new Date(`${iteration.deadline}T23:59:59`).getTime()
          : null;
        return {...iteration, trackedSeconds, onTime};
      });
  }

  function taskStats(task){
    const iterations = normalizeIterations(task);
    return {
      iterations,
      allocatedHours: iterations.reduce((sum,i)=>sum + Number(i.allotted_hours || 0), 0),
      trackedSeconds: iterations.reduce((sum,i)=>sum + i.trackedSeconds, 0),
      completed: iterations.filter(i=>i.status === "approved").length,
      onTime: iterations.filter(i=>i.onTime === true).length,
      breached: iterations.filter(i=>i.onTime === false).length,
      revisions: iterations.reduce((sum,i)=>sum + Number(i.revision_count || 0), 0),
      finalDeadline: iterations.map(i=>i.deadline).filter(Boolean).sort().at(-1) || null
    };
  }

  function collectIterationRows(containerId){
    const rows = [...document.querySelectorAll(`#${containerId} .iteration-plan-row`)];
    return rows.map((row,index)=>({
      id: row.dataset.id || null,
      iteration_no:index + 1,
      title:row.querySelector('[data-field="title"]').value.trim(),
      description:row.querySelector('[data-field="description"]').value.trim(),
      allotted_hours:Number(row.querySelector('[data-field="hours"]').value),
      deadline:row.querySelector('[data-field="deadline"]').value
    }));
  }

  function validatePlan(iterations){
    if(!iterations.length) return "Add at least one iteration";
    for(const [index,item] of iterations.entries()){
      if(!item.title) return `Enter title for iteration ${index + 1}`;
      if(!item.allotted_hours || item.allotted_hours <= 0) return `Enter allocated hours for iteration ${index + 1}`;
      if(!item.deadline) return `Enter deadline for iteration ${index + 1}`;
      if(index > 0 && item.deadline < iterations[index - 1].deadline){
        return `Iteration ${index + 1} deadline cannot be before iteration ${index}`;
      }
    }
    return null;
  }

  function addPlanRow(containerId, values={}){
    const container = document.getElementById(containerId);
    const number = container.querySelectorAll(".iteration-plan-row").length + 1;
    const row = document.createElement("div");
    row.className = "card iteration-plan-row";
    row.dataset.id = values.id || "";
    row.dataset.canDelete = values.canDelete ? "1" : "0";
    row.style.marginBottom = "12px";
    row.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <strong class="iteration-plan-number">Iteration ${number}</strong>
        ${values.canDelete ? `<button type="button" class="danger-btn" onclick="IterationWorkflow.removePlanRow(this,'${containerId}')"> Remove </button>` : `<button type="button" disabled class="lock-btn"> Cannot Delete </button>`}
      </div>
      <div class="form-grid" style="margin-top:10px">
        <div class="form-field"><label>Iteration title</label><input class="input-field" data-field="title" value="${escapeHtml(values.title || "")}"></div>
        <div class="form-field"><label>Allocated hours</label><input type="number" min="0.25" step="0.25" class="input-field" data-field="hours" value="${escapeHtml(values.allotted_hours || "")}"></div>
        <div class="form-field"><label>Deadline</label><input type="date" class="input-field" data-field="deadline" value="${escapeHtml(values.deadline || "")}"></div>
      </div>
      <div class="form-field"><label>Description</label><textarea class="input-field" data-field="description" style="width:100%;min-height:70px">${escapeHtml(values.description || "")}</textarea></div>`;
    container.appendChild(row);
  }

  function removePlanRow(button, containerId){
    const container = document.getElementById(containerId);
    if(container.querySelectorAll(".iteration-plan-row").length === 1){
      showToast("A task must have at least one iteration", "error");
      return;
    }
    button.closest(".iteration-plan-row").remove();
    [...container.querySelectorAll(".iteration-plan-number")]
      .forEach((label,index)=>label.textContent = `Iteration ${index + 1}`);
  }

  function revisionHtml(iteration){
    const revisions = [...(iteration.task_iteration_revisions || [])]
      .sort((a,b)=>Number(a.revision_no) - Number(b.revision_no));
    if(!revisions.length) return "<p>No revisions</p>";
    return revisions.map(r=>`
      <div style="padding:8px 0;border-top:1px solid #eee">
        <strong>Revision ${r.revision_no}</strong>
        <div>${escapeHtml(r.reason)}</div>
        <small>${r.requested_at ? new Date(r.requested_at).toLocaleString() : "-"}</small>
      </div>`).join("");
  }

  window.IterationWorkflow = {
    escapeHtml, duration, normalizeIterations, taskStats,
    collectIterationRows, validatePlan, addPlanRow, removePlanRow, revisionHtml
  };
})();
