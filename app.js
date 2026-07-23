/* Nousomplex Attendance Portal — browser-only client. Data access is protected by Supabase RLS. */
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
  const flash = (message, error = false) => { const el = $("#flash"); el.textContent = message; el.className = `flash ${error ? "error" : ""}`; el.style.display = "block"; setTimeout(() => el.style.display = "none", 4500); };
  const setTemplate = id => { content.replaceChildren($(id).content.cloneNode(true)); };
  const empty = text => `<div class="empty">${esc(text)}</div>`;
  const isAdmin = () => state.profile?.role === "admin";
  const ensureConfigured = () => { if (!configured) { $("#auth-message").textContent = "Add your Supabase Project URL and anon key to config.js before signing in."; return false; } return true; };
 
  // Hide loading screen
  function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.style.display = 'none';
    }
  }

  // Enhanced function to hide admin-only elements
  function applyRoleVisibility() {
    const admin = isAdmin();
    // Hide/show elements with data-admin-only attribute
    document.querySelectorAll("[data-admin-only]").forEach(el => {
      el.style.display = admin ? "" : "none";
    });
    
    // Also hide/show the Teachers tab in sidebar
    const teachersTab = document.querySelector('[data-page="teachers"]');
    if (teachersTab) {
      teachersTab.style.display = admin ? "" : "none";
    }
  }

  // Function to set up observation of content changes
  function setupVisibilityObserver() {
    // Apply visibility immediately
    applyRoleVisibility();
    
    // Watch for changes in the page content (when templates are loaded)
    const observer = new MutationObserver(() => {
      applyRoleVisibility();
    });
    
    // Start observing
    const pageContent = document.getElementById('page-content');
    if (pageContent) {
      observer.observe(pageContent, {
        childList: true,
        subtree: true
      });
    }
    
    // Also watch the entire document for changes
    const docObserver = new MutationObserver(() => {
      applyRoleVisibility();
    });
    docObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Run again after short delays to catch any late-loaded content
    setTimeout(applyRoleVisibility, 100);
    setTimeout(applyRoleVisibility, 500);
    setTimeout(applyRoleVisibility, 1000);
  }
 
  async function api(run) { const { data, error } = await run; if (error) throw error; return data; }
  async function getClasses() { state.classes = await api(state.db.from("classes").select("id,name,section,academic_year,teacher_id,teachers(name)").order("name")); return state.classes; }
  function classOptions(selected = "", none = "Select a class") { return `<option value="">${none}</option>` + state.classes.map(c => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}${c.section ? " — " + esc(c.section) : ""}</option>`).join(""); }
 
  async function loadSession() {
    try {
      const { data: { session } } = await state.db.auth.getSession();
      if (!session) {
        hideLoadingScreen();
        return showAuth();
      }
      state.user = session.user;
      state.profile = await api(state.db.from("profiles").select("*").eq("id", state.user.id).single());
      state.teacher = await api(state.db.from("teachers").select("*").eq("profile_id", state.user.id).maybeSingle());
      
      // Get the display name from profile (full_name) or fallback to email
      const displayName = state.profile.full_name || state.profile.email;
      $("#user-name").textContent = displayName;
      $("#user-role").textContent = state.profile.role;
      $("#auth-screen").classList.add("hidden"); 
      $("#app").classList.remove("hidden");
      
      // Hide loading screen before showing content
      hideLoadingScreen();
      
      applyRoleVisibility(); 
      await navigate("dashboard");
      // Apply visibility again after navigation
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
    // Make sure loading screen is hidden
    hideLoadingScreen();
  }
 
  async function signIn(event) {
    event.preventDefault(); if (!ensureConfigured()) return;
    const email = $("#auth-email").value.trim(), password = $("#auth-password").value;
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
    const email = $("#auth-email").value.trim(), password = $("#auth-password").value;
    if (!email || !password) return $("#auth-message").textContent = "Enter an email and a password of at least 8 characters first.";
    try { 
      await api(state.db.auth.signUp({ email, password, options: { data: { full_name: email.split("@")[0] } } })); 
      $("#auth-message").textContent = "Account created. Check your email to confirm it, then ask an administrator to activate your teacher profile."; 
    } catch (e) { 
      $("#auth-message").textContent = e.message; 
    }
  }
 
  async function navigate(page) {
    state.page = page; document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.page === page));
    $("#page-title").textContent = ({ dashboard:"Dashboard", attendance:"Mark attendance", students:"Students", classes:"Classes", teachers:"Teachers", reports:"Reports & exports" })[page];
    $("#today").textContent = fmt.format(new Date()); $(".sidebar")?.classList.remove("open");
    try { 
      await ({ dashboard, attendance, students, classes, teachers, reports })[page](); 
      // Apply visibility after each page loads
      setTimeout(applyRoleVisibility, 100);
    } catch (e) { content.innerHTML = empty(e.message); flash(e.message, true); }
  }
 
  async function dashboard() {
    setTemplate("#dashboard-template"); const day = isoToday(); const classes = await getClasses();
    const students = await api(state.db.from("students").select("id"));
    const sessions = await api(state.db.from("attendance_sessions").select("id,classes(name,section)").eq("attendance_date", day));
    const ids = sessions.map(s => s.id); const records = ids.length ? await api(state.db.from("attendance_records").select("status,attendance_sessions(id,classes(name,section))").in("session_id", ids)) : [];
    const present = records.filter(r => r.status === "present").length, rate = records.length ? Math.round(present / records.length * 100) : 0;
    $("[data-stat='students']").textContent = students.length; $("[data-stat='classes']").textContent = classes.length; $("[data-stat='present']").textContent = present; $("[data-stat='rate']").textContent = `${rate}%`;
    const rows = sessions.map(s => { const rs = records.filter(r => r.attendance_sessions?.id === s.id); return `<tr><td>${esc(s.classes?.name)} ${esc(s.classes?.section || "")}</td><td>${rs.filter(r => r.status === "present").length}</td><td>${rs.filter(r => r.status === "absent").length}</td><td>${rs.filter(r => r.status === "leave").length}</td></tr>`; }).join("");
    $("#today-table").innerHTML = rows ? `<div class="table-wrap"><table><thead><tr><th>Class</th><th>Present</th><th>Absent</th><th>Leave</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty("No attendance has been recorded today.");
    $("[data-go='attendance']").onclick = () => navigate("attendance");
    applyRoleVisibility();
  }
 
  async function attendance() {
    setTemplate("#attendance-template"); await getClasses(); $("#attendance-date").value = isoToday(); $("#attendance-class").innerHTML = classOptions();
    $("#load-roster").onclick = loadRoster; $("#save-attendance").onclick = saveAttendance;
    applyRoleVisibility();
  }
  async function loadRoster() {
    const classId = $("#attendance-class").value, date = $("#attendance-date").value; if (!classId || !date) return flash("Choose a class and date.", true);
    const students = await api(state.db.from("students").select("id,name,roll_number").eq("class_id", classId).eq("active", true).order("roll_number"));
    const session = await api(state.db.from("attendance_sessions").select("id").eq("class_id", classId).eq("attendance_date", date).maybeSingle());
    const existing = session ? await api(state.db.from("attendance_records").select("student_id,status,remarks").eq("session_id", session.id)) : [];
    const map = Object.fromEntries(existing.map(r => [r.student_id, r]));
    $("#roster").innerHTML = students.length ? `<div class="table-wrap"><table><thead><tr><th>Roll no.</th><th>Student</th><th>Status</th><th>Remarks</th></tr></thead><tbody>${students.map(s => { const r = map[s.id] || { status:"present", remarks:"" }; return `<tr data-student="${s.id}"><td>${esc(s.roll_number)}</td><td>${esc(s.name)}</td><td><select class="status-select"><option value="present" ${r.status === "present" ? "selected" : ""}>Present</option><option value="absent" ${r.status === "absent" ? "selected" : ""}>Absent</option><option value="leave" ${r.status === "leave" ? "selected" : ""}>Leave</option></select></td><td><input class="remarks" value="${esc(r.remarks || "")}" maxlength="250"></td></tr>`; }).join("")}</tbody></table></div>` : empty("No active students exist in this class.");
    $("#save-attendance").disabled = !students.length;
    applyRoleVisibility();
  }
  async function saveAttendance() {
    const classId = $("#attendance-class").value, date = $("#attendance-date").value; if (!classId || !date) return;
    try {
      let session = await api(state.db.from("attendance_sessions").select("id").eq("class_id", classId).eq("attendance_date", date).maybeSingle());
      if (!session) session = await api(state.db.from("attendance_sessions").insert({ class_id:classId, attendance_date:date }).select("id").single());
      const records = [...document.querySelectorAll("#roster tbody tr")].map(row => ({ session_id:session.id, student_id:row.dataset.student, status:$(".status-select", row).value, remarks:$(".remarks", row).value.trim() || null }));
      await api(state.db.from("attendance_records").upsert(records, { onConflict:"session_id,student_id" })); flash("Attendance saved successfully.");
    } catch (e) { flash(e.message, true); }
  }
 
  async function students() {
    setTemplate("#students-template"); await getClasses(); const admin = isAdmin();
    let rows = await api(state.db.from("students").select("id,name,roll_number,email,phone,class_id,active,classes(name,section)").order("roll_number"));
    if (!admin) rows = rows.filter(s => s.active);
    $("#students-class-filter").innerHTML = classOptions("", "All classes");
    const renderTable = () => {
      const filterClass = $("#students-class-filter").value;
      const filtered = filterClass ? rows.filter(s => s.class_id === filterClass) : rows;
      $("#students-table").innerHTML = filtered.length ? `<div class="table-wrap"><table><thead><tr><th>Roll no.</th><th>Name</th><th>Class</th><th>Email</th><th>Phone</th>${admin ? "<th>Status</th><th>Actions</th>" : ""}</tr></thead><tbody>${filtered.map(s => `<tr data-id="${s.id}"><td>${esc(s.roll_number)}</td><td>${esc(s.name)}</td><td>${esc(s.classes?.name)} ${esc(s.classes?.section || "")}</td><td>${esc(s.email || "—")}</td><td>${esc(s.phone || "—")}</td>${admin ? `<td><span class="status ${s.active ? "present" : "absent"}">${s.active ? "Active" : "Inactive"}</span></td><td class="row-actions"><button class="text-button edit-student" type="button">Edit</button><button class="text-button toggle-student" type="button">${s.active ? "Disable" : "Enable"}</button><button class="text-button danger delete-student" type="button">Delete</button></td>` : ""}</tr>`).join("")}</tbody></table></div>` : empty("No students found.");
      if (admin) {
        $$(".edit-student").forEach(btn => btn.onclick = () => showStudentForm(rows.find(r => r.id === btn.closest("tr").dataset.id)));
        $$(".delete-student").forEach(btn => btn.onclick = () => deleteStudent(btn.closest("tr").dataset.id));
        $$(".toggle-student").forEach(btn => btn.onclick = () => { const s = rows.find(r => r.id === btn.closest("tr").dataset.id); toggleStudentActive(s.id, s.active); });
      }
      applyRoleVisibility();
    };
    renderTable();
    $("#students-class-filter").onchange = renderTable;
    if (admin) $("#new-student").onclick = () => showStudentForm();
    applyRoleVisibility();
  }
  async function toggleStudentActive(id, currentActive) {
    try { await api(state.db.from("students").update({ active: !currentActive }).eq("id", id)); flash(!currentActive ? "Student enabled — visible to teachers again." : "Student disabled — hidden from teachers and attendance marking."); students(); }
    catch (err) { flash(err.message, true); }
  }
  function showStudentForm(student = null) {
    const form = $("#student-form"); form.classList.remove("hidden");
    form.innerHTML = `<form id="student-create"><label>Name<input name="name" required value="${student ? esc(student.name) : ""}"></label><label>Roll no.<input name="roll" required value="${student ? esc(student.roll_number) : ""}"></label><label>Class<select name="class" required>${classOptions(student?.class_id || "", "Select class")}</select></label><label>Email<input name="email" type="email" value="${student ? esc(student.email || "") : ""}"></label><label>Phone<input name="phone" value="${student ? esc(student.phone || "") : ""}"></label><div class="toolbar"><button class="primary">${student ? "Save changes" : "Save student"}</button>${student ? `<button type="button" class="text-button" id="cancel-student">Cancel</button>` : ""}</div></form>`;
    $("#student-create").onsubmit = e => student ? updateStudent(e, student.id) : createStudent(e);
    if (student) $("#cancel-student").onclick = () => form.classList.add("hidden");
    applyRoleVisibility();
  }
  async function createStudent(e) { e.preventDefault(); const f = new FormData(e.target); try { await api(state.db.from("students").insert({ name:f.get("name"), roll_number:f.get("roll"), class_id:f.get("class"), email:f.get("email") || null, phone:f.get("phone") || null })); flash("Student registered."); students(); } catch (err) { flash(err.message, true); } }
  async function updateStudent(e, id) { e.preventDefault(); const f = new FormData(e.target); try { await api(state.db.from("students").update({ name:f.get("name"), roll_number:f.get("roll"), class_id:f.get("class"), email:f.get("email") || null, phone:f.get("phone") || null }).eq("id", id)); flash("Student updated."); students(); } catch (err) { flash(err.message, true); } }
  async function deleteStudent(id) {
    if (!confirm("Delete this student? This cannot be undone.")) return;
    try { await api(state.db.from("students").delete().eq("id", id)); flash("Student deleted."); students(); }
    catch (err) { flash(/foreign key|violat/i.test(err.message) ? "This student has attendance history and cannot be deleted." : err.message, true); }
  }
 
  async function classes() {
    setTemplate("#classes-template"); await getClasses(); const admin = isAdmin();
    $("#classes-table").innerHTML = state.classes.length ? `<div class="table-wrap"><table><thead><tr><th>Class</th><th>Section</th><th>Academic year</th><th>Teacher</th>${admin ? "<th>Actions</th>" : ""}</tr></thead><tbody>${state.classes.map(c => `<tr data-id="${c.id}"><td>${esc(c.name)}</td><td>${esc(c.section || "—")}</td><td>${esc(c.academic_year)}</td><td>${esc(c.teachers?.name || "Unassigned")}</td>${admin ? `<td class="row-actions"><button class="text-button edit-class" type="button">Edit</button><button class="text-button danger delete-class" type="button">Delete</button></td>` : ""}</tr>`).join("")}</tbody></table></div>` : empty("No classes found.");
    if (admin) {
      $("#new-class").onclick = () => showClassForm();
      $$(".edit-class").forEach(btn => btn.onclick = () => showClassForm(state.classes.find(c => c.id === btn.closest("tr").dataset.id)));
      $$(".delete-class").forEach(btn => btn.onclick = () => deleteClass(btn.closest("tr").dataset.id));
    }
    applyRoleVisibility();
  }
  async function showClassForm(cls = null) {
    const teachers = await api(state.db.from("teachers").select("id,name").order("name"));
    const form = $("#class-form"); form.classList.remove("hidden");
    form.innerHTML = `<form id="class-create"><label>Class name<input name="name" placeholder="Grade 8" required value="${cls ? esc(cls.name) : ""}"></label><label>Section<input name="section" value="${cls ? esc(cls.section || "") : "A"}"></label><label>Academic year<input name="year" required value="${cls ? esc(cls.academic_year) : new Date().getFullYear()}"></label><label>Teacher<select name="teacher"><option value="">Unassigned</option>${teachers.map(t => `<option value="${t.id}" ${cls?.teacher_id === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label><div class="toolbar"><button class="primary">${cls ? "Save changes" : "Save class"}</button>${cls ? `<button type="button" class="text-button" id="cancel-class">Cancel</button>` : ""}</div></form>`;
    $("#class-create").onsubmit = e => cls ? updateClass(e, cls.id) : createClass(e);
    if (cls) $("#cancel-class").onclick = () => form.classList.add("hidden");
    applyRoleVisibility();
  }
  async function createClass(e) { e.preventDefault(); const f = new FormData(e.target); try { await api(state.db.from("classes").insert({ name:f.get("name"), section:f.get("section"), academic_year:f.get("year"), teacher_id:f.get("teacher") || null })); flash("Class created."); classes(); } catch (err) { flash(err.message, true); } }
  async function updateClass(e, id) { e.preventDefault(); const f = new FormData(e.target); try { await api(state.db.from("classes").update({ name:f.get("name"), section:f.get("section"), academic_year:f.get("year"), teacher_id:f.get("teacher") || null }).eq("id", id)); flash("Class updated."); classes(); } catch (err) { flash(err.message, true); } }
  async function deleteClass(id) {
    if (!confirm("Delete this class? This cannot be undone.")) return;
    try { await api(state.db.from("classes").delete().eq("id", id)); flash("Class deleted."); classes(); }
    catch (err) { flash(/foreign key|violat/i.test(err.message) ? "This class still has students assigned and cannot be deleted." : err.message, true); }
  }
 
  async function teachers() {
    if (!isAdmin()) return navigate("dashboard"); setTemplate("#teachers-template");
    const [profiles, registered] = await Promise.all([api(state.db.from("profiles").select("id,full_name,email").eq("role", "teacher").order("email")), api(state.db.from("teachers").select("id,profile_id,name,phone,can_export,profiles(email)").order("name"))]);
    const used = new Set(registered.map(t => t.profile_id)); const available = profiles.filter(p => !used.has(p.id));
    showTeacherActivateForm(available);
    $("#teachers-table").innerHTML = registered.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Report downloads</th><th>Actions</th></tr></thead><tbody>${registered.map(t => `<tr data-id="${t.id}"><td>${esc(t.name)}</td><td>${esc(t.profiles?.email)}</td><td>${esc(t.phone || "—")}</td><td><span class="status ${t.can_export !== false ? "present" : "absent"}">${t.can_export !== false ? "Allowed" : "Restricted"}</span></td><td class="row-actions"><button class="text-button edit-teacher" type="button">Edit</button><button class="text-button danger delete-teacher" type="button">Delete</button></td></tr>`).join("")}</tbody></table></div>` : empty("No teacher profiles activated.");
    $$(".edit-teacher").forEach(btn => btn.onclick = () => showTeacherEditForm(registered.find(t => t.id === btn.closest("tr").dataset.id)));
    $$(".delete-teacher").forEach(btn => btn.onclick = () => deleteTeacher(btn.closest("tr").dataset.id));
    applyRoleVisibility();
  }
  function showTeacherActivateForm(available) {
    $("#teacher-form").innerHTML = available.length ? `<form id="teacher-create"><label>Account<select name="profile" required><option value="">Select signed-up teacher</option>${available.map(p => `<option value="${p.id}">${esc(p.full_name || p.email)} (${esc(p.email)})</option>`).join("")}</select></label><label>Display name<input name="name" required></label><label>Phone<input name="phone"></label><label>
