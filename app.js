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

  // ============================================================
  // ===== REPORTS PAGE =====
  // ============================================================
  
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
    $("#pdf-export").onclick = () => { if (allowExport) exportPDF(); }; 
    $("#report-view").onchange = applyReportView; 
    await runReport();
    $("#report-view").value = "summary";
    applyReportView();
  }

  // ============================================================
  // ===== UPDATED runReport() with Holiday & Designated Day Counts =====
  // ============================================================

  async function runReport() {
    const from = document.getElementById('report-from').value;
    const to = document.getElementById('report-to').value;
    const classId = document.getElementById('report-class').value;
    const studentId = document.getElementById('report-student').value;
    
    if (!from || !to || from > to) return flash("Choose a valid date range.", true);
    
    // Get sessions in date range
    let q = state.db.from("attendance_sessions").select("id,attendance_date,class_id,classes(name,section)")
      .gte("attendance_date", from).lte("attendance_date", to).order("attendance_date");
    if (classId) q = q.eq("class_id", classId);
    const sessions = await api(q);
    const ids = sessions.map(s => s.id);
    
    // Get attendance records
    let records = ids.length ? await api(state.db.from("attendance_records")
      .select("id,session_id,student_id,status,remarks,students(name,roll_number)")
      .in("session_id", ids)) : [];
    if (studentId) records = records.filter(r => r.student_id === studentId);
    
    // Get holidays and designated days in the date range
    let holidayQuery = state.db.from("holidays").select("date,class_id").gte("date", from).lte("date", to);
    let designatedQuery = state.db.from("designated_days").select("date,class_id").gte("date", from).lte("date", to);
    
    if (classId) {
      holidayQuery = holidayQuery.eq("class_id", classId);
      designatedQuery = designatedQuery.eq("class_id", classId);
    }
    
    const holidays = await api(holidayQuery);
    const designatedDays = await api(designatedQuery);
    
    // Count holidays and designated days per student
    const holidayDates = new Set(holidays.map(h => h.date));
    const designatedDates = new Set(designatedDays.map(d => d.date));
    
    const bySession = Object.fromEntries(sessions.map(s => [s.id, s]));
    state.reportRows = records.map(r => {
      const session = bySession[r.session_id];
      const date = session?.attendance_date || '';
      return {
        id: r.id,
        date: date,
        class: session?.classes?.name ? `${session.classes.name} ${session.classes.section || ''}`.trim() : '',
        student: r.students?.name || '',
        roll: r.students?.roll_number || '',
        status: r.status,
        remarks: r.remarks || '',
        isHoliday: holidayDates.has(date),
        isDesignated: designatedDates.has(date)
      };
    });
    
    state.reportRows.sort((a, b) => (a.roll || '').localeCompare(b.roll || '', undefined, { numeric: true }));
    
    // Summary stats
    const present = state.reportRows.filter(r => r.status === "present").length;
    const absent = state.reportRows.filter(r => r.status === "absent").length;
    const leave = state.reportRows.filter(r => r.status === "leave").length;
    const totalHolidays = state.reportRows.filter(r => r.isHoliday).length;
    const totalDesignated = state.reportRows.filter(r => r.isDesignated).length;
    
    document.getElementById('report-summary').innerHTML = `
      <article><span>Present</span><strong>${present}</strong></article>
      <article><span>Absent</span><strong>${absent}</strong></article>
      <article><span>Leave</span><strong>${leave}</strong></article>
      <article><span>Holidays</span><strong>${totalHolidays}</strong></article>
      <article><span>Designated Days</span><strong>${totalDesignated}</strong></article>
    `;
    
    const admin = isAdmin();
    document.getElementById('report-table').innerHTML = state.reportRows.length ? 
      `<div class="table-wrap"><table><thead><tr><th>Roll no.</th><th>Student</th><th>Date</th><th>Class</th><th>Status</th><th>Remarks</th>${admin ? '<th>Holiday</th><th>Designated</th>' : ''}</tr></thead><tbody>${state.reportRows.map(r => `<tr><td>${esc(r.roll)}</td><td>${esc(r.student)}</td><td>${esc(r.date)}</td><td>${esc(r.class)}</td><td>${admin ? `<select class="status-edit" data-id="${r.id}"><option value="present" ${r.status === "present" ? "selected" : ""}>Present</option><option value="absent" ${r.status === "absent" ? "selected" : ""}>Absent</option><option value="leave" ${r.status === "leave" ? "selected" : ""}>Leave</option></select>` : `<span class="status ${r.status}">${esc(r.status)}</span>`}</td><td>${esc(r.remarks || "—")}</td>${admin ? `<td>${r.isHoliday ? '✅' : '—'}</td><td>${r.isDesignated ? '⭐' : '—'}</td>` : ''}</tr>`).join("")}</tbody></table></div>` : 
      empty("No attendance records match this report.");
    
    if (admin) document.querySelectorAll(".status-edit").forEach(sel => sel.onchange = () => updateRecordStatus(sel.dataset.id, sel.value));
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

  // ============================================================
  // ===== IMPROVED PDF EXPORT =====
  // ============================================================

  function exportPDF() {
    if (!state.reportRows.length) return flash("Run a report with data before exporting.", true);
    if (!(isAdmin() || state.teacher?.can_export !== false)) return flash("Report downloads are disabled for your account.", true);
    
    const rows = computeStudentSummary();
    const admin = isAdmin();
    
    // Get date range from report filters
    const fromDate = document.getElementById('report-from')?.value || '';
    const toDate = document.getElementById('report-to')?.value || '';
    const classFilter = document.getElementById('report-class')?.value || '';
    const className = classFilter ? state.classes.find(c => c.id === classFilter)?.name || '' : 'All Classes';
    
    // Build HTML for PDF
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Attendance Report</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            padding: 30px;
            color: #1a1a2e;
            max-width: 1000px;
            margin: 0 auto;
            background: #ffffff;
          }
          .header {
            text-align: center;
            border-bottom: 3px solid #4f46e5;
            padding-bottom: 15px;
            margin-bottom: 20px;
          }
          .header h1 {
            font-size: 28px;
            color: #1a1a2e;
            margin: 0;
          }
          .header h1 span {
            color: #4f46e5;
          }
          .header h2 {
            font-weight: 400;
            color: #6b7280;
            margin: 5px 0 0 0;
            font-size: 18px;
          }
          .header p {
            color: #9ca3af;
            font-size: 13px;
            margin: 5px 0 0 0;
          }
          .report-meta {
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            background: #f8fafc;
            padding: 15px 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 13px;
            border: 1px solid #e5e7eb;
          }
          .report-meta .meta-item {
            margin: 3px 0;
          }
          .report-meta .meta-item strong {
            color: #1a1a2e;
          }
          .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
            gap: 12px;
            margin-bottom: 25px;
          }
          .stats-grid .stat-box {
            background: #f8fafc;
            padding: 12px 15px;
            border-radius: 8px;
            text-align: center;
            border: 1px solid #e5e7eb;
          }
          .stats-grid .stat-box .number {
            font-size: 22px;
            font-weight: bold;
            color: #1a1a2e;
            display: block;
          }
          .stats-grid .stat-box .label {
            font-size: 12px;
            color: #6b7280;
            display: block;
            margin-top: 2px;
          }
          .stats-grid .stat-box.highlight {
            background: #eef2ff;
            border-color: #4f46e5;
          }
          .stats-grid .stat-box.highlight .number {
            color: #4f46e5;
          }
          .stats-grid .stat-box.green {
            background: #f0fdf4;
            border-color: #86efac;
          }
          .stats-grid .stat-box.green .number {
            color: #166534;
          }
          .stats-grid .stat-box.red {
            background: #fef2f2;
            border-color: #fca5a5;
          }
          .stats-grid .stat-box.red .number {
            color: #991b1b;
          }
          .stats-grid .stat-box.yellow {
            background: #fefce8;
            border-color: #fde047;
          }
          .stats-grid .stat-box.yellow .number {
            color: #854d0e;
          }
          .section-title {
            font-size: 18px;
            color: #1a1a2e;
            margin: 25px 0 12px 0;
            padding-bottom: 8px;
            border-bottom: 2px solid #e5e7eb;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            margin-top: 10px;
          }
          table th {
            background: #f1f5f9;
            color: #1a1a2e;
            font-weight: 600;
            padding: 10px 12px;
            text-align: left;
            border-bottom: 2px solid #e2e8f0;
          }
          table td {
            padding: 8px 12px;
            border-bottom: 1px solid #e2e8f0;
          }
          table tr:nth-child(even) {
            background: #fafafa;
          }
          .badge {
            display: inline-block;
            padding: 2px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
          }
          .badge.present { background: #dcfce7; color: #166534; }
          .badge.absent { background: #fef2f2; color: #991b1b; }
          .badge.leave { background: #fef3c7; color: #92400e; }
          .badge.holiday { background: #e0e7ff; color: #3730a3; }
          .badge.designated { background: #fef9c3; color: #854d0e; }
          .footer {
            text-align: center;
            color: #9ca3af;
            font-size: 12px;
            margin-top: 30px;
            border-top: 1px solid #e5e7eb;
            padding-top: 15px;
          }
          .footer p {
            margin: 3px 0;
          }
          .icon {
            font-size: 16px;
          }
          @media print {
            body { padding: 15px; }
            .stats-grid .stat-box { break-inside: avoid; }
            table { page-break-inside: auto; }
            tr { page-break-inside: avoid; }
          }
          @media (max-width: 600px) {
            body { padding: 10px; }
            .stats-grid { grid-template-columns: 1fr 1fr; }
            .report-meta { flex-direction: column; gap: 5px; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Nous <span>Complex</span></h1>
          <h2>Attendance Report</h2>
          <p>Generated on: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
        
        <div class="report-meta">
          <span class="meta-item"><strong>📅 Date Range:</strong> ${fromDate} to ${toDate}</span>
          <span class="meta-item"><strong>📚 Class:</strong> ${className}</span>
          <span class="meta-item"><strong>👨‍🎓 Total Students:</strong> ${rows.length}</span>
          <span class="meta-item"><strong>📝 Total Records:</strong> ${state.reportRows.length}</span>
        </div>
        
        <div class="stats-grid">
          <div class="stat-box green">
            <span class="number">${state.reportRows.filter(r => r.status === "present").length}</span>
            <span class="label">✅ Present</span>
          </div>
          <div class="stat-box red">
            <span class="number">${state.reportRows.filter(r => r.status === "absent").length}</span>
            <span class="label">❌ Absent</span>
          </div>
          <div class="stat-box yellow">
            <span class="number">${state.reportRows.filter(r => r.status === "leave").length}</span>
            <span class="label">📋 Leave</span>
          </div>
          <div class="stat-box highlight">
            <span class="number">${state.reportRows.filter(r => r.isHoliday).length}</span>
            <span class="label">🎉 Holidays</span>
          </div>
          <div class="stat-box highlight">
            <span class="number">${state.reportRows.filter(r => r.isDesignated).length}</span>
            <span class="label">⭐ Designated Days</span>
          </div>
        </div>
        
        <h3 class="section-title">📊 Student Summary</h3>
        <table>
          <thead>
            <tr>
              <th>Roll No.</th>
              <th>Student</th>
              <th>Present</th>
              <th>Absent</th>
              <th>Leave</th>
              <th>Total</th>
              <th>Attendance %</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td>${esc(r.roll)}</td>
              <td>${esc(r.student)}</td>
              <td>${r.present}</td>
              <td>${r.absent}</td>
              <td>${r.leave}</td>
              <td>${r.total}</td>
              <td><strong>${r.pct}%</strong></td>
            </tr>`).join("")}
          </tbody>
        </table>
        
        <h3 class="section-title">📋 Detailed Records</h3>
        <table>
          <thead>
            <tr>
              <th>Roll</th>
              <th>Student</th>
              <th>Date</th>
              <th>Class</th>
              <th>Status</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            ${state.reportRows.map(r => `<tr>
              <td>${esc(r.roll)}</td>
              <td>${esc(r.student)}</td>
              <td>${esc(r.date)}</td>
              <td>${esc(r.class)}</td>
              <td><span class="badge ${r.status}">${esc(r.status)}</span></td>
              <td>${esc(r.remarks || "—")}</td>
            </tr>`).join("")}
          </tbody>
        </table>
        
        <div class="footer">
          <p>📊 Report generated from <strong>Nous Complex Attendance Portal</strong></p>
          <p>© ${new Date().getFullYear()} Nous Complex • All Rights Reserved</p>
        </div>
      </body>
      </html>
    `;
    
    // Open print dialog
    const win = window.open('', '_blank', 'width=1000,height=800,scrollbars=yes');
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => {
        win.print();
      }, 800);
    } else {
      flash("Please allow popups to export PDF.", true);
    }
  }

  // --- Admin Tools Page ---
  async function adminTools() {
    if (!isAdmin()) return navigate("dashboard");
    setTemplate("#admin-tools-template");
    await getClasses();
    
    // ===== Populate dropdowns =====
    const classOptionsHtml = `<option value="">All Classes</option>` + 
      state.classes.map(c => `<option value="${c.id}">${esc(c.name)}${c.section ? " — " + esc(c.section) : ""}</option>`).join("");
    
    document.getElementById('clear-class').innerHTML = classOptionsHtml;
    document.getElementById('holiday-class').innerHTML = classOptionsHtml;
    document.getElementById('designated-class').innerHTML = classOptionsHtml;
    
    // ===== Clear attendance =====
    document.getElementById('clear-class').onchange = async () => {
      const classId = document.getElementById('clear-class').value;
      if (classId) {
        const students = await api(state.db.from("students").select("id,name,roll_number").eq("class_id", classId).order("roll_number"));
        document.getElementById('clear-student').innerHTML = `<option value="">All Students</option>` + 
          students.map(s => `<option value="${s.id}">${esc(s.roll_number)} — ${esc(s.name)}</option>`).join("");
      } else {
        document.getElementById('clear-student').innerHTML = `<option value="">All Students</option>`;
      }
    };
    
    const now = new Date();
    const monthAgo = new Date(now);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    document.getElementById('clear-from').value = monthAgo.toISOString().slice(0, 10);
    document.getElementById('clear-to').value = isoToday();
    
    document.getElementById('clear-attendance').onclick = clearAttendanceData;
    
    // ===== Holidays =====
    document.getElementById('holiday-date').value = isoToday();
    document.getElementById('add-holiday').onclick = addHoliday;
    document.getElementById('bulk-holiday').onclick = () => {
      const form = document.getElementById('holiday-bulk-form');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
      document.getElementById('holiday-from').value = isoToday();
      document.getElementById('holiday-to').value = isoToday();
    };
    document.getElementById('holiday-bulk-submit').onclick = bulkAddHolidays;
    await loadHolidays();
    
    // ===== Designated Days =====
    document.getElementById('designated-date').value = isoToday();
    document.getElementById('add-designated').onclick = addDesignatedDay;
    document.getElementById('bulk-designated').onclick = () => {
      const form = document.getElementById('designated-bulk-form');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
      document.getElementById('designated-from').value = isoToday();
      document.getElementById('designated-to').value = isoToday();
    };
    document.getElementById('designated-bulk-submit').onclick = bulkAddDesignatedDays;
    await loadDesignatedDays();
    
    applyRoleVisibility();
  }

  // ============================================================
  // ===== HOLIDAYS MANAGEMENT FUNCTIONS (Admin Only) =====
  // ============================================================

  async function loadHolidays() {
    try {
      const holidays = await api(state.db.from("holidays").select("id,class_id,date,reason,classes(name,section)").order("date", { ascending: false }));
      
      const list = document.getElementById('holidays-list');
      if (!list) return;
      
      if (holidays.length === 0) {
        list.innerHTML = '<div class="empty">No holidays set.</div>';
        return;
      }
      
      list.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Class</th><th>Reason</th><th>Actions</th></tr></thead><tbody>${holidays.map(h => `<tr data-id="${h.id}"><td>${esc(h.date)}</td><td>${h.classes ? esc(h.classes.name) + (h.classes.section ? " — " + esc(h.classes.section) : "") : "All Classes"}</td><td>${esc(h.reason || "—")}</td><td><button class="text-button danger remove-item" data-id="${h.id}" data-type="holiday" style="color:#ef4444;">Remove</button></td></tr>`).join("")}</tbody></table></div>`;
      
      document.querySelectorAll('#holidays-list .remove-item').forEach(btn => {
        btn.onclick = () => removeHoliday(btn.dataset.id);
      });
    } catch (err) {
      flash(err.message, true);
    }
  }

  async function addHoliday() {
    const classId = document.getElementById('holiday-class').value || null;
    const date = document.getElementById('holiday-date').value;
    const reason = document.getElementById('holiday-reason').value.trim() || "Holiday";
    
    if (!date) {
      flash("Please select a date.", true);
      return;
    }
    
    try {
      await api(state.db.from("holidays").insert({ class_id: classId, date, reason }));
      flash("Holiday added successfully.");
      document.getElementById('holiday-reason').value = "";
      await loadHolidays();
    } catch (err) {
      flash(err.message, true);
    }
  }

  async function removeHoliday(id) {
    if (!confirm("Remove this holiday?")) return;
    try {
      await api(state.db.from("holidays").delete().eq("id", id));
      flash("Holiday removed.");
      await loadHolidays();
    } catch (err) {
      flash(err.message, true);
    }
  }

  async function bulkAddHolidays() {
    const classId = document.getElementById('holiday-class').value || null;
    const fromDate = document.getElementById('holiday-from').value;
    const toDate = document.getElementById('holiday-to').value;
    const reason = document.getElementById('holiday-bulk-reason').value.trim() || "Holiday";
    
    if (!fromDate || !toDate) {
      flash("Please select both from and to dates.", true);
      return;
    }
    
    if (fromDate > toDate) {
      flash("From date must be before to date.", true);
      return;
    }
    
    const dates = getDateRange(fromDate, toDate);
    
    try {
      for (const date of dates) {
        await api(state.db.from("holidays").insert({ class_id: classId, date, reason }));
      }
      flash(`Added ${dates.length} holidays.`);
      document.getElementById('holiday-bulk-reason').value = "";
      await loadHolidays();
      document.getElementById('holiday-bulk-form').style.display = 'none';
    } catch (err) {
      flash(err.message, true);
    }
  }

  // ============================================================
  // ===== DESIGNATED DAYS MANAGEMENT FUNCTIONS (Admin Only) =====
  // ============================================================

  async function loadDesignatedDays() {
    try {
      const designated = await api(state.db.from("designated_days").select("id,class_id,date,reason,classes(name,section)").order("date", { ascending: false }));
      
      const list = document.getElementById('designated-list');
      if (!list) return;
      
      if (designated.length === 0) {
        list.innerHTML = '<div class="empty">No designated days set.</div>';
        return;
      }
      
      list.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Class</th><th>Reason</th><th>Actions</th></tr></thead><tbody>${designated.map(d => `<tr data-id="${d.id}"><td>${esc(d.date)}</td><td>${d.classes ? esc(d.classes.name) + (d.classes.section ? " — " + esc(d.classes.section) : "") : "All Classes"}</td><td>${esc(d.reason || "—")}</td><td><button class="text-button danger remove-item" data-id="${d.id}" data-type="designated" style="color:#ef4444;">Remove</button></td></tr>`).join("")}</tbody></table></div>`;
      
      document.querySelectorAll('#designated-list .remove-item').forEach(btn => {
        btn.onclick = () => removeDesignatedDay(btn.dataset.id);
      });
    } catch (err) {
      flash(err.message, true);
    }
  }

  async function addDesignatedDay() {
    const classId = document.getElementById('designated-class').value || null;
    const date = document.getElementById('designated-date').value;
    const reason = document.getElementById('designated-reason').value.trim() || "Designated Day";
    
    if (!date) {
      flash("Please select a date.", true);
      return;
    }
    
    try {
      await api(state.db.from("designated_days").insert({ class_id: classId, date, reason }));
      flash("Designated day added successfully.");
      document.getElementById('designated-reason').value = "";
      await loadDesignatedDays();
    } catch (err) {
      flash(err.message, true);
    }
  }

  async function removeDesignatedDay(id) {
    if (!confirm("Remove this designated day?")) return;
    try {
      await api(state.db.from("designated_days").delete().eq("id", id));
      flash("Designated day removed.");
      await loadDesignatedDays();
    } catch (err) {
      flash(err.message, true);
    }
  }

  async function bulkAddDesignatedDays() {
    const classId = document.getElementById('designated-class').value || null;
    const fromDate = document.getElementById('designated-from').value;
    const toDate = document.getElementById('designated-to').value;
    const reason = document.getElementById('designated-bulk-reason').value.trim() || "Designated Day";
    
    if (!fromDate || !toDate) {
      flash("Please select both from and to dates.", true);
      return;
    }
    
    if (fromDate > toDate) {
      flash("From date must be before to date.", true);
      return;
    }
    
    const dates = getDateRange(fromDate, toDate);
    
    try {
      for (const date of dates) {
        await api(state.db.from("designated_days").insert({ class_id: classId, date, reason }));
      }
      flash(`Added ${dates.length} designated days.`);
      document.getElementById('designated-bulk-reason').value = "";
      await loadDesignatedDays();
      document.getElementById('designated-bulk-form').style.display = 'none';
    } catch (err) {
      flash(err.message, true);
    }
  }

  // ============================================================
  // ===== HELPER FUNCTIONS =====
  // ============================================================

  function getDateRange(from, to) {
    const dates = [];
    const current = new Date(from);
    const end = new Date(to);
    
    while (current <= end) {
      dates.push(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  // ============================================================
  // ===== CLEAR ATTENDANCE DATA =====
  // ============================================================

  async function clearAttendanceData() {
    if (!isAdmin()) {
      flash("Only admins can clear attendance data.", true);
      return;
    }
    
    const from = document.getElementById('clear-from').value;
    const to = document.getElementById('clear-to').value;
    const classId = document.getElementById('clear-class').value;
    const studentId = document.getElementById('clear-student').value;
    
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
      document.getElementById('clear-result').innerHTML = `<div style="color: green; padding: 10px; background: rgba(34,197,94,0.1); border-radius: 6px;">✅ ${sessionIds.length} session(s) cleared successfully.</div>`;
    } catch (err) {
      flash(err.message, true);
      document.getElementById('clear-result').innerHTML = `<div style="color: #ef4444; padding: 10px; background: rgba(239,68,68,0.1); border-radius: 6px;">❌ Error: ${err.message}</div>`;
    }
  }

  // ============================================================
  // ===== SIDEBAR TOGGLE FUNCTIONS =====
  // ============================================================

  function openSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
  }

  // ============================================================
  // ===== INIT =====
  // ============================================================

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
    
    // ===== MOBILE SIDEBAR TOGGLE =====
    const menuToggle = document.getElementById('menu-toggle-btn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const closeBtn = document.getElementById('sidebar-close-btn');

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

    if (overlay) {
      overlay.addEventListener('click', closeSidebar);
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', closeSidebar);
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeSidebar();
      }
    });

    window.addEventListener('resize', function() {
      if (window.innerWidth > 768 && sidebar) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        document.body.style.overflow = '';
      }
    });

    document.addEventListener('click', function(e) {
      const navButton = e.target.closest('#nav button[data-page]');
      if (navButton && window.innerWidth <= 768) {
        setTimeout(closeSidebar, 300);
      }
    });

    // ===== NAVIGATION =====
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
})();/* Nousomplex Attendance Portal — Complete with all features */
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
