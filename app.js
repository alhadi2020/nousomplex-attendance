/* Nousomplex Attendance Portal — Complete with all features */
(() => {
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL?.startsWith("https://") && !cfg.SUPABASE_ANON_KEY?.startsWith("PASTE_");
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const content = $("#page-content");
  const state = { db: null, user: null, profile: null, teacher: null, page: "dashboard", classes: [], reportRows: [] };
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const isoToday = () => new Date().toISOString().slice(0, 10);
  const esc = (v = "") => String(v).replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[c]);
  const flash = (message, error = false) => { 
    const el = $("#flash"); 
    el.textContent = message; 
    el.className = `flash ${error ? "error" : "success"}`; 
    el.style.display = "block"; 
    setTimeout(() => el.style.display = "none", 4500); 
  };
  const setTemplate = id => { content.replaceChildren($(id).content.cloneNode(true)); };
  const empty = text => `<div class="empty">${esc(text)}</div>`;
  const isAdmin = () => state.profile?.role === "admin";
  const ensureConfigured = () => { if (!configured) { $("#auth-message").textContent = "Add your Supabase Project URL and anon key to config.js before signing in."; return false; } return true; };
 
  // --- Loading Screen Controls ---
  function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.style.display = 'none';
    }
  }

  function showLoadingScreen(message = 'Loading attendance portal...') {
    const loadingScreen = document.getElementById('loading-screen');
    const messageEl = document.getElementById('loading-message');
    if (loadingScreen) {
      loadingScreen.style.display = 'flex';
    }
    if (messageEl) {
      messageEl.textContent = message;
    }
  }

  // --- Cache Management ---
  let cachedClasses = null;
  
  async function getClasses() {
    if (cachedClasses) {
      state.classes = cachedClasses;
      return cachedClasses;
    }
    state.classes = await api(state.db.from("classes").select("id,name,section,academic_year,teacher_id,teachers(name)").order("name"));
    cachedClasses = state.classes;
    return state.classes;
  }

  function classOptions(selected = "", none = "Select a class", includeAll = false) { 
    let html = includeAll ? `<option value="">${none}</option>` : `<option value="">${none}</option>`;
    html += state.classes.map(c => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}${c.section ? " — " + esc(c.section) : ""}</option>`).join("");
    return html;
  }

  // --- Admin Visibility ---
  function applyRoleVisibility() {
    const admin = isAdmin();
    document.querySelectorAll("[data-admin-only]").forEach(el => {
      el.style.display = admin ? "" : "none";
    });
    const teachersTab = document.querySelector('[data-page="teachers"]');
    if (teachersTab) {
      teachersTab.style.display = admin ? "" : "none";
    }
    const adminToolsTab = document.querySelector('[data-page="admin-tools"]');
    if (adminToolsTab) {
      adminToolsTab.style.display = admin ? "" : "none";
    }
  }

  // --- API Helper ---
  async function api(run) { 
    const { data, error } = await run; 
    if (error) throw error; 
    return data; 
  }

  // --- Session Management ---
  async function loadSession() {
    try {
      showLoadingScreen('Checking session...');
      
      const { data: { session } } = await state.db.auth.getSession();
      
      if (!session) {
        hideLoadingScreen();
        return showAuth();
      }
      
      state.user = session.user;
      showLoadingScreen('Loading profile...');
      
      const [profile, teacher] = await Promise.all([
        api(state.db.from("profiles").select("*").eq("id", state.user.id).single()),
        api(state.db.from("teachers").select("*").eq("profile_id", state.user.id).maybeSingle())
      ]);
      
      state.profile = profile;
      state.teacher = teacher;
      
      showLoadingScreen('Loading dashboard...');
      
      const displayName = state.profile.full_name || state.profile.email;
      $("#user-name").textContent = displayName;
      $("#user-role").textContent = state.profile.role;
      
      $("#auth-screen").classList.add("hidden"); 
      $("#app").classList.remove("hidden");
      $("#menu-toggle-btn")?.classList.remove("is-hidden");
      
      applyRoleVisibility();
      await navigate("dashboard");
      hideLoadingScreen();
      setTimeout(applyRoleVisibility, 200);
      
    } catch (error) {
      console.error('Session loading error:', error);
      hideLoadingScreen();
      showAuth();
    }
  }

  function showAuth() { 
    state.user = state.profile = state.teacher = null; 
    $("#app").classList.add("hidden"); 
    $("#auth-screen").classList.remove("hidden");
    $("#menu-toggle-btn")?.classList.add("is-hidden");
    cachedClasses = null;
    hideLoadingScreen();
  }

  // --- Authentication ---
  async function signIn(event) {
    event.preventDefault(); 
    if (!ensureConfigured()) return;
    
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    
    if (!email || !password) {
      $("#auth-message").textContent = "Please enter both email and password.";
      return;
    }
    
    showLoadingScreen('Signing in...');
    
    try { 
      await api(state.db.auth.signInWithPassword({ email, password })); 
      await loadSession(); 
    } catch (e) { 
      $("#auth-message").textContent = e.message; 
      hideLoadingScreen();
    }
  }

  async function signUp() {
    if (!ensureConfigured()) return;
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    
    if (!email || !password || password.length < 8) {
      return $("#auth-message").textContent = "Enter an email and a password of at least 8 characters first.";
    }
    
    showLoadingScreen('Creating account...');
    
    try { 
      await api(state.db.auth.signUp({ 
        email, 
        password, 
        options: { data: { full_name: email.split("@")[0] } } 
      })); 
      $("#auth-message").textContent = "Account created. Check your email to confirm it, then ask an administrator to activate your teacher profile."; 
      hideLoadingScreen();
    } catch (e) { 
      $("#auth-message").textContent = e.message; 
      hideLoadingScreen();
    }
  }

  // --- Forgot Password ---
  async function forgotPassword() {
    const email = $("#auth-email").value.trim();
    if (!email) {
      $("#auth-message").textContent = "Please enter your email address first.";
      return;
    }
    
    showLoadingScreen('Sending reset email...');
    
    try {
      const { error } = await state.db.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/nousomplex-attendance/'
      });
      if (error) throw error;
      $("#auth-message").textContent = "Password reset email sent. Check your inbox.";
      hideLoadingScreen();
    } catch (e) {
      $("#auth-message").textContent = e.message;
      hideLoadingScreen();
    }
  }

  // --- Reset Password (after clicking email link) ---
  async function resetPassword() {
    const password = $("#reset-password").value;
    const confirm = $("#reset-password-confirm").value;
    const messageEl = $("#reset-message");
    
    if (!password || password.length < 8) {
      messageEl.textContent = "Password must be at least 8 characters.";
      return;
    }
    
    if (password !== confirm) {
      messageEl.textContent = "Passwords do not match.";
      return;
    }
    
    messageEl.textContent = "";
    showLoadingScreen('Updating password...');
    
    try {
      const { error } = await state.db.auth.updateUser({ password });
      if (error) throw error;
      
      hideLoadingScreen();
      $("#reset-modal").classList.remove("show");
      flash("Password updated successfully. Please sign in with your new password.");
      $("#reset-password").value = "";
      $("#reset-password-confirm").value = "";
      $("#reset-message").textContent = "";
      
      await state.db.auth.signOut();
      showAuth();
    } catch (e) {
      hideLoadingScreen();
      messageEl.textContent = e.message;
    }
  }

  // --- Navigation ---
  async function navigate(page) {
    state.page = page; 
    document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.page === page));
    $("#page-title").textContent = ({ 
      dashboard:"Dashboard", 
      attendance:"Mark attendance", 
      students:"Students", 
      classes:"Classes", 
      teachers:"Teachers", 
      reports:"Reports & exports",
      "admin-tools":"Admin Tools"
    })[page];
    $("#today").textContent = fmt.format(new Date()); 
    
    try { 
      await ({ 
        dashboard, 
        attendance, 
        students, 
        classes, 
        teachers, 
        reports,
        "admin-tools": adminTools
      })[page](); 
      setTimeout(applyRoleVisibility, 100);
    } catch (e) { 
      content.innerHTML = empty(e.message); 
      flash(e.message, true); 
    }
  }

  // --- Dashboard ---
  async function dashboard() {
    setTemplate("#dashboard-template"); 
    const day = isoToday();
    
    const [students, sessions] = await Promise.all([
      api(state.db.from("students").select("id")),
      api(state.db.from("attendance_sessions").select("id,classes(name,section)").eq("attendance_date", day))
    ]);
    
    const ids = sessions.map(s => s.id); 
    const records = ids.length ? await api(state.db.from("attendance_records").select("status,attendance_sessions(id,classes(name,section))").in("session_id", ids)) : [];
    
    const present = records.filter(r => r.status === "present").length;
    const rate = records.length ? Math.round(present / records.length * 100) : 0;
    
    $("[data-stat='students']").textContent = students.length; 
    $("[data-stat='classes']").textContent = state.classes.length; 
    $("[data-stat='present']").textContent = present; 
    $("[data-stat='rate']").textContent = `${rate}%`;
    
    const rows = sessions.map(s => { 
      const rs = records.filter(r => r.attendance_sessions?.id === s.id); 
      return `<tr><td>${esc(s.classes?.name)} ${esc(s.classes?.section || "")}</td><td>${rs.filter(r => r.status === "present").length}</td><td>${rs.filter(r => r.status === "absent").length}</td><td>${rs.filter(r => r.status === "leave").length}</td></tr>`; 
    }).join("");
    
    $("#today-table").innerHTML = rows ? `<div class="table-wrap"><table><thead><tr><th>Class</th><th>Present</th><th>Absent</th><th>Leave</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty("No attendance has been recorded today.");
    $("[data-go='attendance']").onclick = () => navigate("attendance");
    applyRoleVisibility();
  }

  // --- Attendance Page ---
  async function attendance() {
    setTemplate("#attendance-template"); 
    await getClasses(); 
    $("#attendance-date").value = isoToday(); 
    $("#attendance-class").innerHTML = classOptions();
    $("#load-roster").onclick = loadRoster; 
    $("#save-attendance").onclick = saveAttendance;
    applyRoleVisibility();
  }

  async function loadRoster() {
    const classId = $("#attendance-class").value;
    const date = $("#attendance-date").value;
    
    if (!classId || !date) {
      return flash("Choose a class and date.", true);
    }
    
    const students = await api(state.db.from("students").select("id,name,roll_number").eq("class_id", classId).eq("active", true).order("roll_number"));
    const session = await api(state.db.from("attendance_sessions").select("id").eq("class_id", classId).eq("attendance_date", date).maybeSingle());
    const existing = session ? await api(state.db.from("attendance_records").select("student_id,status,remarks").eq("session_id", session.id)) : [];
    const map = Object.fromEntries(existing.map(r => [r.student_id, r]));
    
    $("#roster").innerHTML = students.length ? 
      `<div class="table-wrap"><table><thead><tr><th>Roll no.</th><th>Student</th><th>Status</th><th>Remarks</th></tr></thead><tbody>${students.map(s => { 
        const r = map[s.id] || { status:"present", remarks:"" }; 
        return `<tr data-student="${s.id}"><td>${esc(s.roll_number)}</td><td>${esc(s.name)}</td><td><select class="status-select"><option value="present" ${r.status === "present" ? "selected" : ""}>Present</option><option value="absent" ${r.status === "absent" ? "selected" : ""}>Absent</option><option value="leave" ${r.status === "leave" ? "selected" : ""}>Leave</option></select></td><td><input class="remarks" value="${esc(r.remarks || "")}" maxlength="250"></td></tr>`; 
      }).join("")}</tbody></table></div>` : 
      empty("No active students exist in this class.");
    
    $("#save-attendance").disabled = !students.length;
    applyRoleVisibility();
  }

  async function saveAttendance() {
    const classId = $("#attendance-class").value;
    const date = $("#attendance-date").value;
    
    if (!classId || !date) return;
    
    try {
      let session = await api(state.db.from("attendance_sessions").select("id").eq("class_id", classId).eq("attendance_date", date).maybeSingle());
      if (!session) {
        session = await api(state.db.from("attendance_sessions").insert({ class_id:classId, attendance_date:date }).select("id").single());
      }
      
      const records = [...document.querySelectorAll("#roster tbody tr")].map(row => ({ 
        session_id:session.id, 
        student_id:row.dataset.student, 
        status:$(".status-select", row).value, 
        remarks:$(".remarks", row).value.trim() || null 
      }));
      
      await api(state.db.from("attendance_records").upsert(records, { onConflict:"session_id,student_id" })); 
      flash("Attendance saved successfully.");
    } catch (e) { 
      flash(e.message, true); 
    }
  }

  // --- Students Page ---
  async function students() {
    setTemplate("#students-template"); 
    await getClasses(); 
    const admin = isAdmin();
    let rows = await api(state.db.from("students").select("id,name,roll_number,email,phone,class_id,active,classes(name,section)").order("roll_number"));
    if (!admin) rows = rows.filter(s => s.active);
    
    $("#students-class-filter").innerHTML = classOptions("", "All classes");
    
    const renderTable = () => {
      const filterClass = $("#students-class-filter").value;
      const filtered = filterClass ? rows.filter(s => s.class_id === filterClass) : rows;
      
      $("#students-table").innerHTML = filtered.length ? 
        `<div class="table-wrap"><table><thead><tr><th>Roll no.</th><th>Name</th><th>Class</th><th>Email</th><th>Phone</th>${admin ? "<th>Status</th><th>Actions</th>" : ""}</tr></thead><tbody>${filtered.map(s => `<tr data-id="${s.id}"><td>${esc(s.roll_number)}</td><td>${esc(s.name)}</td><td>${esc(s.classes?.name)} ${esc(s.classes?.section || "")}</td><td>${esc(s.email || "—")}</td><td>${esc(s.phone || "—")}</td>${admin ? `<td><span class="status ${s.active ? "present" : "absent"}">${s.active ? "Active" : "Inactive"}</span></td><td class="row-actions"><button class="text-button edit-student" type="button">Edit</button><button class="text-button toggle-student" type="button">${s.active ? "Disable" : "Enable"}</button><button class="text-button danger delete-student" type="button">Delete</button></td>` : ""}</tr>`).join("")}</tbody></table></div>` : 
        empty("No students found.");
      
      if (admin) {
        $$(".edit-student").forEach(btn => btn.onclick = () => showStudentForm(rows.find(r => r.id === btn.closest("tr").dataset.id)));
        $$(".delete-student").forEach(btn => btn.onclick = () => deleteStudent(btn.closest("tr").dataset.id));
        $$(".toggle-student").forEach(btn => btn.onclick = () => { 
          const s = rows.find(r => r.id === btn.closest("tr").dataset.id); 
          toggleStudentActive(s.id, s.active); 
        });
      }
      applyRoleVisibility();
    };
    
    renderTable();
    $("#students-class-filter").onchange = renderTable;
    if (admin) $("#new-student").onclick = () => showStudentForm();
    applyRoleVisibility();
  }

  async function toggleStudentActive(id, currentActive) {
    try { 
      await api(state.db.from("students").update({ active: !currentActive }).eq("id", id)); 
      flash(!currentActive ? "Student enabled — visible to teachers again." : "Student disabled — hidden from teachers and attendance marking."); 
      students(); 
    } catch (err) { 
      flash(err.message, true); 
    }
  }

  function showStudentForm(student = null) {
    const form = $("#student-form"); 
    form.classList.remove("hidden");
    form.innerHTML = `<form id="student-create"><label>Name<input name="name" required value="${student ? esc(student.name) : ""}"></label><label>Roll no.<input name="roll" required value="${student ? esc(student.roll_number) : ""}"></label><label>Class<select name="class" required>${classOptions(student?.class_id || "", "Select class")}</select></label><label>Email<input name="email" type="email" value="${student ? esc(student.email || "") : ""}"></label><label>Phone<input name="phone" value="${student ? esc(student.phone || "") : ""}"></label><div class="toolbar"><button class="primary">${student ? "Save changes" : "Save student"}</button>${student ? `<button type="button" class="text-button" id="cancel-student">Cancel</button>` : ""}</div></form>`;
    $("#student-create").onsubmit = e => student ? updateStudent(e, student.id) : createStudent(e);
    if (student) $("#cancel-student").onclick = () => form.classList.add("hidden");
    applyRoleVisibility();
  }

  async function createStudent(e) { 
    e.preventDefault(); 
    const f = new FormData(e.target); 
    try { 
      await api(state.db.from("students").insert({ 
        name:f.get("name"), 
        roll_number:f.get("roll"), 
        class_id:f.get("class"), 
        email:f.get("email") || null, 
        phone:f.get("phone") || null 
      })); 
      flash("Student registered."); 
      students(); 
    } catch (err) { 
      flash(err.message, true); 
    } 
  }

  async function updateStudent(e, id) { 
    e.preventDefault(); 
    const f = new FormData(e.target); 
    try { 
      await api(state.db.from("students").update({ 
        name:f.get("name"), 
        roll_number:f.get("roll"), 
        class_id:f.get("class"), 
        email:f.get("email") || null, 
        phone:f.get("phone") || null 
      }).eq("id", id)); 
      flash("Student updated."); 
      students(); 
    } catch (err) { 
      flash(err.message, true); 
    } 
  }

  async function deleteStudent(id) {
    if (!confirm("Delete this student? This cannot be undone.")) return;
    try { 
      await api(state.db.from("students").delete().eq("id", id)); 
      flash("Student deleted."); 
      students(); 
    } catch (err) { 
      flash(/foreign key|violat/i.test(err.message) ? "This student has attendance history and cannot be deleted." : err.message, true); 
    }
  }

  // --- Classes Page ---
  async function classes() {
    setTemplate("#classes-template"); 
    await getClasses(); 
    const admin = isAdmin();
    
    $("#classes-table").innerHTML = state.classes.length ? 
      `<div class="table-wrap"><table><thead><tr><th>Class</th><th>Section</th><th>Academic year</th><th>Teacher</th>${admin ? "<th>Actions</th>" : ""}</tr></thead><tbody>${state.classes.map(c => `<tr data-id="${c.id}"><td>${esc(c.name)}</td><td>${esc(c.section || "—")}</td><td>${esc(c.academic_year)}</td><td>${esc(c.teachers?.name || "Unassigned")}</td>${admin ? `<td class="row-actions"><button class="text-button edit-class" type="button">Edit</button><button class="text-button danger delete-class" type="button">Delete</button></td>` : ""}</tr>`).join("")}</tbody></table></div>` : 
      empty("No classes found.");
    
    if (admin) {
      $("#new-class").onclick = () => showClassForm();
      $$(".edit-class").forEach(btn => btn.onclick = () => showClassForm(state.classes.find(c => c.id === btn.closest("tr").dataset.id)));
      $$(".delete-class").forEach(btn => btn.onclick = () => deleteClass(btn.closest("tr").dataset.id));
    }
    applyRoleVisibility();
  }

  async function showClassForm(cls = null) {
    const teachers = await api(state.db.from("teachers").select("id,name").order("name"));
    const form = $("#class-form"); 
    form.classList.remove("hidden");
    form.innerHTML = `<form id="class-create"><label>Class name<input name="name" placeholder="Grade 8" required value="${cls ? esc(cls.name) : ""}"></label><label>Section<input name="section" value="${cls ? esc(cls.section || "") : "A"}"></label><label>Academic year<input name="year" required value="${cls ? esc(cls.academic_year) : new Date().getFullYear()}"></label><label>Teacher<select name="teacher"><option value="">Unassigned</option>${teachers.map(t => `<option value="${t.id}" ${cls?.teacher_id === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label><div class="toolbar"><button class="primary">${cls ? "Save changes" : "Save class"}</button>${cls ? `<button type="button" class="text-button" id="cancel-class">Cancel</button>` : ""}</div></form>`;
    $("#class-create").onsubmit = e => cls ? updateClass(e, cls.id) : createClass(e);
    if (cls) $("#cancel-class").onclick = () => form.classList.add("hidden");
    applyRoleVisibility();
  }

  async function createClass(e) { 
    e.preventDefault(); 
    const f = new FormData(e.target); 
    try { 
      await api(state.db.from("classes").insert({ 
        name:f.get("name"), 
        section:f.get("section"), 
        academic_year:f.get("year"), 
        teacher_id:f.get("teacher") || null 
      })); 
      flash("Class created."); 
      classes(); 
    } catch (err) { 
      flash(err.message, true); 
    } 
  }

  async function updateClass(e, id) { 
    e.preventDefault(); 
    const f = new FormData(e.target); 
    try { 
      await api(state.db.from("classes").update({ 
        name:f.get("name"), 
        section:f.get("section"), 
        academic_year:f.get("year"), 
        teacher_id:f.get("teacher") || null 
      }).eq("id", id)); 
      flash("Class updated."); 
      classes(); 
    } catch (err) { 
      flash(err.message, true); 
    } 
  }

  async function deleteClass(id) {
    if (!confirm("Delete this class? This cannot be undone.")) return;
    try { 
      await api(state.db.from("classes").delete().eq("id", id)); 
      flash("Class deleted."); 
      classes(); 
    } catch (err) { 
      flash(/foreign key|violat/i.test(err.message) ? "This class still has students assigned and cannot be deleted." : err.message, true); 
    }
  }

  // --- Teachers Page ---
  async function teachers() {
    if (!isAdmin()) return navigate("dashboard"); 
    setTemplate("#teachers-template");
    const [profiles, registered] = await Promise.all([
      api(state.db.from("profiles").select("id,full_name,email").eq("role", "teacher").order("email")),
      api(state.db.from("teachers").select("id,profile_id,name,phone,can_export,profiles(email)").order("name"))
    ]);
    const used = new Set(registered.map(t => t.profile_id)); 
    const available = profiles.filter(p => !used.has(p.id));
    showTeacherActivateForm(available);
    $("#teachers-table").innerHTML = registered.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Report downloads</th><th>Actions</th></tr></thead><tbody>${registered.map(t => `<tr data-id="${t.id}"><td>${esc(t.name)}</td><td>${esc(t.profiles?.email)}</td><td>${esc(t.phone || "—")}</td><td><span class="status ${t.can_export !== false ? "present" : "absent"}">${t.can_export !== false ? "Allowed" : "Restricted"}</span></td><td class="row-actions"><button class="text-button edit-teacher" type="button">Edit</button><button class="text-button danger delete-teacher" type="button">Delete</button></td></tr>`).join("")}</tbody></table></div>` : empty("No teacher profiles activated.");
    $$(".edit-teacher").forEach(btn => btn.onclick = () => showTeacherEditForm(registered.find(t => t.id === btn.closest("tr").dataset.id)));
    $$(".delete-teacher").forEach(btn => btn.onclick = () => deleteTeacher(btn.closest("tr").dataset.id));
    applyRoleVisibility();
  }

  function showTeacherActivateForm(available) {
    $("#teacher-form").innerHTML = available.length ? `<form id="teacher-create"><label>Account<select name="profile" required><option value="">Select signed-up teacher</option>${available.map(p => `<option value="${p.id}">${esc(p.full_name || p.email)} (${esc(p.email)})</option>`).join("")}</select></label><label>Display name<input name="name" required></label><label>Phone<input name="phone"></label><label>Report downloads<select name="can_export"><option value="true" selected>Allowed</option><option value="false">Restricted</option></select></label><button class="primary">Activate teacher</button></form>` : `<p class="muted">No unassigned teacher accounts. Ask the teacher to sign up first.</p>`;
    const form = $("#teacher-create"); if (form) form.onsubmit = async e => { e.preventDefault(); const f = new FormData(form); try { await api(state.db.from("teachers").insert({ profile_id:f.get("profile"), name:f.get("name"), phone:f.get("phone") || null, can_export:f.get("can_export") === "true" })); flash("Teacher profile activated."); teachers(); } catch (err) { flash(err.message, true); } };
    applyRoleVisibility();
  }

  function showTeacherEditForm(teacher) {
    $("#teacher-form").innerHTML = `<form id="teacher-edit"><label>Display name<input name="name" required value="${esc(teacher.name)}"></label><label>Phone<input name="phone" value="${esc(teacher.phone || "")}"></label><label>Report downloads<select name="can_export"><option value="true" ${teacher.can_export !== false ? "selected" : ""}>Allowed</option><option value="false" ${teacher.can_export === false ? "selected" : ""}>Restricted</option></select></label><div class="toolbar"><button class="primary">Save changes</button><button type="button" class="text-button" id="cancel-teacher">Cancel</button></div></form>`;
    $("#teacher-edit").onsubmit = e => updateTeacher(e, teacher.id);
    $("#cancel-teacher").onclick = () => teachers();
    applyRoleVisibility();
  }

  async function updateTeacher(e, id) { e.preventDefault(); const f = new FormData(e.target); try { await api(state.db.from("teachers").update({ name:f.get("name"), phone:f.get("phone") || null, can_export:f.get("can_export") === "true" }).eq("id", id)); flash("Teacher updated."); teachers(); } catch (err) { flash(err.message, true); } }

  async function deleteTeacher(id) {
    if (!confirm("Remove this teacher profile? Their sign-in account stays intact and can be reactivated later, but they'll be unassigned from any classes.")) return;
    try { await api(state.db.from("teachers").delete().eq("id", id)); flash("Teacher profile removed."); teachers(); }
    catch (err) { flash(err.message, true); }
  }

  // --- Reports Page ---
  async function reports() {
    setTemplate("#reports-template"); 
    await getClasses(); 
    const now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), 1); 
    $("#report-from").value = start.toISOString().slice(0, 10); 
    $("#report-to").value = isoToday(); 
    $("#report-class").innerHTML = classOptions("", "All available classes", true);
    $("#report-class").onchange = async () => { 
      const classId = $("#report-class").value; 
      const students = await api(state.db.from("students").select("id,name,roll_number").eq("class_id", classId || "00000000-0000-0000-0000-000000000000").order("roll_number")); 
      $("#report-student").innerHTML = `<option value="">All students</option>${students.map(s => `<option value="${s.id}">${esc(s.roll_number)} — ${esc(s.name)}</option>`).join("")}`; 
    };
    const allowExport = isAdmin() || state.teacher?.can_export !== false;
    $$(".export-only").forEach(el => el.classList.toggle("hidden", !allowExport));
    $("#export-restricted-note")?.classList.toggle("hidden", allowExport);
    $("#run-report").onclick = runReport; 
    $("#excel-export-both").onclick = () => exportExcel("both"); 
    $("#excel-export-summary").onclick = () => exportExcel("summary"); 
    $("#excel-export-detail").onclick = () => exportExcel("detail"); 
    $("#pdf-export").onclick = () => { if (allowExport) window.print(); }; 
    $("#report-view").onchange = applyReportView; 
    await runReport();
    $("#report-view").value = "summary";
    applyReportView();
  }

  async function runReport() {
    const from = $("#report-from").value, to = $("#report-to").value, classId = $("#report-class").value, studentId = $("#report-student").value; 
    if (!from || !to || from > to) return flash("Choose a valid date range.", true);
    let q = state.db.from("attendance_sessions").select("id,attendance_date,class_id,classes(name,section)").gte("attendance_date", from).lte("attendance_date", to).order("attendance_date"); 
    if (classId) q = q.eq("class_id", classId); 
    const sessions = await api(q); 
    const ids = sessions.map(s => s.id);
    let records = ids.length ? await api(state.db.from("attendance_records").select("id,session_id,student_id,status,remarks,students(name,roll_number)").in("session_id", ids)) : []; 
    if (studentId) records = records.filter(r => r.student_id === studentId);
    const bySession = Object.fromEntries(sessions.map(s => [s.id, s])); 
    state.reportRows = records.map(r => ({ id:r.id, date:bySession[r.session_id].attendance_date, class:`${bySession[r.session_id].classes?.name || ""} ${bySession[r.session_id].classes?.section || ""}`.trim(), student:r.students?.name || "", roll:r.students?.roll_number || "", status:r.status, remarks:r.remarks || "" }));
    state.reportRows.sort((a, b) => (a.roll || "").localeCompare(b.roll || "", undefined, { numeric:true }));
    const present = state.reportRows.filter(r => r.status === "present").length, absent = state.reportRows.filter(r => r.status === "absent").length, leave = state.reportRows.filter(r => r.status === "leave").length; 
    $("#report-summary").innerHTML = `<article><span>Present</span><strong>${present}</strong></article><article><span>Absent</span><strong>${absent}</strong></article><article><span>Leave</span><strong>${leave}</strong></article>`;
    const admin = isAdmin();
    $("#report-table").innerHTML = state.reportRows.length ? `<div class="table-wrap"><table><thead><tr><th>Roll no.</th><th>Student</th><th>Date</th><th>Class</th><th>Status</th><th>Remarks</th></tr></thead><tbody>${state.reportRows.map(r => `<tr><td>${esc(r.roll)}</td><td>${esc(r.student)}</td><td>${esc(r.date)}</td><td>${esc(r.class)}</td><td>${admin ? `<select class="status-edit" data-id="${r.id}"><option value="present" ${r.status === "present" ? "selected" : ""}>Present</option><option value="absent" ${r.status === "absent" ? "selected" : ""}>Absent</option><option value="leave" ${r.status === "leave" ? "selected" : ""}>Leave</option></select>` : `<span class="status ${r.status}">${esc(r.status)}</span>`}</td><td>${esc(r.remarks || "—")}</td></tr>`).join("")}</tbody></table></div>` : empty("No attendance records match this report.");
    if (admin) $$(".status-edit").forEach(sel => sel.onchange = () => updateRecordStatus(sel.dataset.id, sel.value));
    renderStudentSummary();
    applyReportView();
  }

  async function updateRecordStatus(id, status) {
    try { await api(state.db.from("attendance_records").update({ status }).eq("id", id)); flash("Attendance status updated."); await runReport(); }
    catch (err) { flash(err.message, true); }
  }

  function applyReportView() {
    const view = $("#report-view")?.value || "summary";
    $("#summary-section").style.display = view === "detail" ? "none" : "";
    $("#detail-section").style.display = view === "summary" ? "none" : "";
  }

  function computeStudentSummary() {
    const map = new Map();
    state.reportRows.forEach(r => {
      const key = r.roll || r.student;
      if (!map.has(key)) map.set(key, { student:r.student, roll:r.roll, present:0, absent:0, leave:0 });
      const entry = map.get(key); entry[r.status] = (entry[r.status] || 0) + 1;
    });
    return [...map.values()].map(e => { const total = e.present + e.absent + e.leave; return { ...e, total, pct: total ? Math.round((e.present / total) * 100) : 0 }; }).sort((a, b) => (a.roll || "").localeCompare(b.roll || "", undefined, { numeric:true }));
  }

  function renderStudentSummary() {
    const rows = computeStudentSummary();
    const el = $("#student-summary-table"); if (!el) return;
    el.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Roll no.</th><th>Student</th><th>Present</th><th>Absent</th><th>Leave</th><th>Total marked</th><th>Attendance %</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.roll)}</td><td>${esc(r.student)}</td><td>${r.present}</td><td>${r.absent}</td><td>${r.leave}</td><td>${r.total}</td><td><strong>${r.pct}%</strong></td></tr>`).join("")}</tbody></table></div>` : empty("No attendance records match this report.");
  }

  function detailSheetData() { return XLSX.utils.json_to_sheet(state.reportRows.map(r => ({ "Roll No.":r.roll, Student:r.student, Date:r.date, Class:r.class, Status:r.status, Remarks:r.remarks }))); }
  function summarySheetData() { return XLSX.utils.json_to_sheet(computeStudentSummary().map(r => ({ "Roll No.":r.roll, Student:r.student, Present:r.present, Absent:r.absent, Leave:r.leave, "Total marked":r.total, "Attendance %":r.pct }))); }

  function exportExcel(mode = "both") {
    if (!state.reportRows.length) return flash("Run a report with data before exporting.", true);
    if (!(isAdmin() || state.teacher?.can_export !== false)) return flash("Report downloads are disabled for your account.", true);
    const book = XLSX.utils.book_new();
    if (mode === "both" || mode === "detail") XLSX.utils.book_append_sheet(book, detailSheetData(), "Attendance");
    if (mode === "both" || mode === "summary") XLSX.utils.book_append_sheet(book, summarySheetData(), "Summary by student");
    const suffix = mode === "both" ? "" : `-${mode}`;
    XLSX.writeFile(book, `attendance-report${suffix}-${isoToday()}.xlsx`);
  }

  // --- Admin Tools Page ---
  async function adminTools() {
    if (!isAdmin()) return navigate("dashboard");
    setTemplate("#admin-tools-template");
    await getClasses();
    
    $("#clear-class").innerHTML = `<option value="">All Classes</option>` + 
      state.classes.map(c => `<option value="${c.id}">${esc(c.name)}${c.section ? " — " + esc(c.section) : ""}</option>`).join("");
    
    $("#clear-class").onchange = async () => {
      const classId = $("#clear-class").value;
      if (classId) {
        const students = await api(state.db.from("students").select("id,name,roll_number").eq("class_id", classId).order("roll_number"));
        $("#clear-student").innerHTML = `<option value="">All Students</option>` + 
          students.map(s => `<option value="${s.id}">${esc(s.roll_number)} — ${esc(s.name)}</option>`).join("");
      } else {
        $("#clear-student").innerHTML = `<option value="">All Students</option>`;
      }
    };
    
    const now = new Date();
    const monthAgo = new Date(now);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    $("#clear-from").value = monthAgo.toISOString().slice(0, 10);
    $("#clear-to").value = isoToday();
    
    $("#clear-attendance").onclick = clearAttendanceData;
    applyRoleVisibility();
  }

  async function clearAttendanceData() {
    if (!isAdmin()) {
      flash("Only admins can clear attendance data.", true);
      return;
    }
    
    const from = $("#clear-from").value;
    const to = $("#clear-to").value;
    const classId = $("#clear-class").value;
    const studentId = $("#clear-student").value;
    
    if (!from || !to) {
      flash("Please select both from and to dates.", true);
      return;
    }
    
    if (from > to) {
      flash("From date must be before to date.", true);
      return;
    }
    
    let confirmMsg = `Are you sure you want to delete all attendance records from ${from} to ${to}?`;
    if (classId) {
      const cls = state.classes.find(c => c.id === classId);
      confirmMsg += `\nClass: ${cls ? cls.name + (cls.section ? " — " + cls.section : "") : "Selected"}`;
    }
    if (studentId) {
      const student = await api(state.db.from("students").select("name,roll_number").eq("id", studentId).single());
      confirmMsg += `\nStudent: ${student ? student.roll_number + " — " + student.name : "Selected"}`;
    }
    confirmMsg += "\n\nThis action CANNOT be undone!";
    
    if (!confirm(confirmMsg)) return;
    
    try {
      let query = state.db.from("attendance_sessions").select("id").gte("attendance_date", from).lte("attendance_date", to);
      if (classId) query = query.eq("class_id", classId);
      const sessions = await api(query);
      const sessionIds = sessions.map(s => s.id);
      
      if (sessionIds.length === 0) {
        flash("No attendance records found in this date range.", true);
        return;
      }
      
      let recordsQuery = state.db.from("attendance_records").delete().in("session_id", sessionIds);
      if (studentId) recordsQuery = recordsQuery.eq("student_id", studentId);
      await api(recordsQuery);
      
      await api(state.db.from("attendance_sessions").delete().in("id", sessionIds));
      
      flash(`Successfully cleared ${sessionIds.length} session(s) of attendance data.`);
      $("#clear-result").innerHTML = `<div style="color: green; padding: 10px; background: rgba(34,197,94,0.1); border-radius: 6px;">✅ ${sessionIds.length} session(s) cleared successfully.</div>`;
    } catch (err) {
      flash(err.message, true);
      $("#clear-result").innerHTML = `<div style="color: #ef4444; padding: 10px; background: rgba(239,68,68,0.1); border-radius: 6px;">❌ Error: ${err.message}</div>`;
    }
  }

  // --- SIDEBAR TOGGLE FUNCTIONS ---
  function openSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
    $("#menu-toggle-btn")?.classList.add("is-hidden");
  }

  function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
    $("#menu-toggle-btn")?.classList.remove("is-hidden");
  }

  // --- INIT ---
  function init() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.style.display = 'flex';
    }
    
    if (configured) state.db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    if (state.db) {
      state.db.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY") {
          hideLoadingScreen();
          $("#reset-modal").classList.add("show");
          window.history.replaceState({}, "", window.location.pathname);
        }
      });
    }
    $("#auth-form").onsubmit = signIn; 
    $("#signup-button").onclick = signUp;
    $("#forgot-password-btn").onclick = forgotPassword;
    $("#signout").onclick = async () => { 
      await state.db.auth.signOut(); 
      cachedClasses = null;
      showAuth(); 
    };
    
    // Reset password modal
    $("#reset-submit").onclick = resetPassword;
    $("#reset-cancel").onclick = () => {
      $("#reset-modal").classList.remove("show");
      $("#reset-password").value = "";
      $("#reset-password-confirm").value = "";
      $("#reset-message").textContent = "";
    };
    
    // --- MOBILE SIDEBAR TOGGLE ---
    const menuToggle = document.getElementById('menu-toggle-btn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const closeBtn = document.getElementById('sidebar-close-btn');

    // Toggle sidebar on menu button click
    if (menuToggle) {
      menuToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        if (sidebar && sidebar.classList.contains('open')) {
          closeSidebar();
        } else {
          openSidebar();
        }
      });
    }

    // Close sidebar on overlay click
    if (overlay) {
      overlay.addEventListener('click', closeSidebar);
    }

    // Close sidebar on close button click
    if (closeBtn) {
      closeBtn.addEventListener('click', closeSidebar);
    }

    // Close sidebar on Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeSidebar();
      }
    });

    // Handle window resize - close sidebar on desktop
    window.addEventListener('resize', function() {
      if (window.innerWidth > 768 && sidebar) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        document.body.style.overflow = '';
      }
    });

    // Close sidebar when clicking a navigation link (mobile)
    document.addEventListener('click', function(e) {
      const navButton = e.target.closest('#nav button[data-page]');
      if (navButton && window.innerWidth <= 768) {
        setTimeout(closeSidebar, 300);
      }
    });

    // --- NAVIGATION ---
    // Use event delegation for navigation buttons
    document.addEventListener('click', function(e) {
      const button = e.target.closest('#nav button[data-page]');
      if (button) {
        e.preventDefault();
        const page = button.dataset.page;
        if (page) {
          navigate(page);
        }
      }
    });
    
    
    // Handle "Mark Attendance" button on dashboard
    document.addEventListener('click', function(e) {
      const goButton = e.target.closest('[data-go]');
      if (goButton) {
        const page = goButton.dataset.go;
        if (page) navigate(page);
      }
    });
    
    if (configured) {
      loadSession();
    } else {
      hideLoadingScreen();
      ensureConfigured();
    }
  }
  
  init();
})();
