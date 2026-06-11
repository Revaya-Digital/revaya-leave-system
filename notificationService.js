async function createNotification(
  employeeId, title, message, type, entityType = null, entityId = null){

  const { error } = await db
  .from("notifications")
  .insert({
    employee_id: employeeId,
    title,
    message,
    notification_type: type,
    entity_type: entityType,
    entity_id: entityId
  });

  if(error){
    console.error(error);
  }
}

async function loadNotificationCount(){
  const empId = await getEmployeeId();
  const { data } = await db
    .from("notifications")
    .select("id")
    .eq("employee_id", empId)
    .eq("is_read", false);

  document.getElementById("notificationBadge").textContent = data?.length || 0;
}

async function openNotifications(){
  const empId = await getEmployeeId();
  const { data } = await db
    .from("notifications")
    .select("*")
    .eq("employee_id", empId)
    .order(
      "created_at",
      {
        ascending:false
      }).limit(50);

  const modal = document.createElement("div");

  modal.className = "modal";
  modal.style.display = "flex";

  modal.innerHTML = `
    <div class="modal-content" style="max-width:700px;">
      <h3> Notifications </h3>
      <div style="max-height:500px; overflow:auto;">
        ${data.length ? data.map(n=>`
            <div class="card" style="margin-bottom:10px; cursor:pointer;" onclick="openNotification('${n.id}', '${n.entity_type || ""}', '${n.entity_id || ""}')">
              <strong> ${n.title} </strong>
              <p> ${n.message} </p>
              <small> ${new Date(n.created_at).toLocaleString()} </small>
            </div>`).join("") : "<p>No notifications</p>"
        }
      </div>
      <div class="modal-actions">
        <button onclick="markAllNotificationsRead()">
          Mark All Read
        </button>
        <button class="secondary-btn" onclick="this.closest('.modal').remove()">
          Close
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

async function markNotificationRead(id){
  await db
  .from("notifications")
  .update({
    is_read:true
  })
  .eq("id",id);

  loadNotificationCount();
}

async function markAllNotificationsRead(){
  const empId = await getEmployeeId();
  await db
  .from("notifications")
  .update({
    is_read:true
  })
  .eq("employee_id", empId);

  document.querySelector(".modal")?.remove();

  loadNotificationCount();
  openNotifications();
}

async function openNotification(notificationId, entityType, entityId){
  await markNotificationRead(notificationId);

  document.querySelector(".modal")?.remove();

  if(
    entityType === "task"
  ){
    openTaskDetails(entityId);
  }
}