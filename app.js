/* Nousomplex Attendance Portal — browser-only client. Data access is protected by Supabase RLS. */
(() => {
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL?.startsWith("https://") && !cfg.SUPABASE_ANON_KEY?.startsWith("PASTE_");
  const $ = (s, root = document) => root.querySelector(s);
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

  async function api(run) { const { data, error } = await run; if (error) throw error; return data; }
  async function getClasses() { state.classes = await api(state.db.from("classes").select("id,name,section,academic_year,teachers(name)").order("name")); return state.classes; }
  function classOptions(selected = "", none = "Select a class") { return `<option value="">${none}</option>` + state.classes.map(c => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}${c.section ? " — " + esc(c.section) : ""}</option>`).join(""); }
  function applyRoleVisibility() { document.querySelectorAll("[data-admin-only]").forEach(el => el.classList.toggle("hidden", !isAdmin())); }

  async function loadSession() {
    const { data: { session } } = await state.db.auth.getSession();
    if (!session) return showAuth();
    state.user = session.user;
    state.profile = await api(state.db.from("profiles").select("*").eq("id", state.user.id).single());
    state.teacher = await api(state.db.from("teachers").select("*").eq("profile_id", state.user.id).maybeSingle());
    $("#user-name").textContent = state.profile.full_name || state.profile.email;
    $("#user-role").textContent = state.profile.role;
    $("#auth-screen").classList.add("hidden"); $("#app").classList.remove("hidden");
    applyRoleVisibility(); await navigate("dashboard");
  }
  function showAuth() { state.user = state.profile = state.teacher = null; $("#app").classList.add("hidden"); $("#auth-screen").classList.remove("hidden"); }

  async function signIn(event) {
    event.preventDefault(); if (!ensureConfigured()) return;
    const email = $("#auth-email").value.trim(), password = $("#auth-password").value;
    try { await api(state.db.auth.signInWithPassword({ email, password })); await loadSession(); } catch (e) { $("#auth-message").textContent = e.message; }
  }
  async function signUp() {
    if (!ensureConfigured()) return;
    const email = $("#auth-email").value.trim(), password = $("#auth-password").value;
    if (!email || !password) return $("#auth-message").textContent = "Enter an email and a password of at least 8 characters first.";
    try { await api(state.db.auth.signUp({ email, password, options: { data: { full_name: email.split("@")[0] } } })); $("#auth-message").textContent = "Account created. Check your email to confirm it, then ask an administrator to activate your teacher profile."; } catch (e) { $("#auth-message").textContent = e.message; }
  }

  async function navigate(page) {
    state.page = page; document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.page === page));
    $("#page-title").textContent = ({ dashboard:"Dashboard", attendance:"Mark attendance", students:"Students", classes:"Classes", teachers:"Teachers", reports:"Reports & exports" })[page];
    $("#today").textContent = fmt.format(new Date()); $(".sidebar")?.classList.remove("open");
    try { await ({ dashboard, attendance, students, classes, teachers, reports })[page](); } catch (e) { content.innerHTML = empty(e.message); flash(e.message, true); }
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
  }

  async function attendance() {
    setTemplate("#attendance-template"); await getClasses(); $("#attendance-date").value = isoToday(); $("#attendance-class").innerHTML = classOptions();
    $("#load-roster").onclick = loadRoster; $("#save-attendance").onclick = saveAttendance;
  }
  async function loadRoster() {
    const classId = $("#attendance-class").value, date = $("#attendance-date").value; if (!classId || !date) return flash("Choose a class and date.", true);
    const students = await api(state.db.from("students").select("id,name,roll_number").eq("class_id", classId).eq("active", true).order("name"));
    const session = await api(state.db.from("attendance_sessions").select("id").eq("class_id", classId).eq("attendance_date", date).maybeSingle());
    const existing = session ? await api(state.db.from("attendance_records").select("student_id,status,remarks").eq("session_id", session.id)) : [];
    const map = Object.fromEntries(existing.map(r => [r.student_id, r]));
    $("#roster").innerHTML = students.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Roll no.</th><th>Status</th><th>Remarks</th></tr></thead><tbody>${students.map(s => { const r = map[s.id] || { status:"present", remarks:"" }; return `<tr data-student="${s.id}"><td>${esc(s.name)}</td><td>${esc(s.roll_number)}</td><td><select class="status-select"><option value="present" ${r.status === "present" ? "selected" : ""}>Present</option><option value="absent" ${r.status === "absent" ? "selected" : ""}>Absent</option><option value="leave" ${r.status === "leave" ? "selected" : ""}>Leave</option></select></td><td><input class="remarks" value="${esc(r.remarks || "")}" maxlength="250"></td></tr>`; }).join("")}</tbody></table></div>` : empty("No active students exist in this class.");
    $("#save-attendance").disabled = !students.length;
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
    setTemplate("#students-template"); await getClasses(); const rows = await api(state.db.from("students").select("id,name,roll_number,email,phone,classes(name,section)").order("name"));
    $("#students-table").innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Roll no.</th><th>Class</th><th>Email</th><th>Phone</th></tr></thead><tbody>${rows.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.roll_number)}</td><td>${esc(s.classes?.name)} ${esc(s.classes?.section || "")}</td><td>${esc(s.email || "—")}</td><td>${esc(s.phone || "—")}</td></tr>`).join("")}</tbody></table></div>` : empty("No students found.");
    if (isAdmin()) $("#new-student").onclick = () => { $("#student-form").classList.remove("hidden"); $("#student-form").innerHTML = `<form id="student-create"><label>Name<input name="name" required></label><label>Roll no.<input name="roll" required></label><label>Class<select name="class" required>${classOptions("", "Select class")}</select></label><label>Email<input name="email" type="email"></label><label>Phone<input name="phone"></label><button class="primary">Save student</button></form>`; $("#student-create").onsubmit = createStudent; };
  }
  async function createStudent(e) { e.preventDefault(); const f = new FormData(e.target); try { await api(state.db.from("students").insert({ name:f.get("name"), roll_number:f.get("roll"), class_id:f.get("class"), email:f.get("email") || null, phone:f.get("phone") || null })); flash("Student registered."); students(); } catch (err) { flash(err.message, true); } }

  async function classes() {
    setTemplate("#classes-template"); await getClasses(); $("#classes-table").innerHTML = state.classes.length ? `<div class="table-wrap"><table><thead><tr><th>Class</th><th>Section</th><th>Academic year</th><th>Teacher</th></tr></thead><tbody>${state.classes.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.section || "—")}</td><td>${esc(c.academic_year)}</td><td>${esc(c.teachers?.name || "Unassigned")}</td></tr>`).join("")}</tbody></table></div>` : empty("No classes found.");
    if (isAdmin()) $("#new-class").onclick = async () => { const teachers = await api(state.db.from("teachers").select("id,name").order("name")); $("#class-form").classList.remove("hidden"); $("#class-form").innerHTML = `<form id="class-create"><label>Class name<input name="name" placeholder="Grade 8" required></label><label>Section<input name="section" value="A"></label><label>Academic year<input name="year" value="${new Date().getFullYear()}" required></label><label>Teacher<select name="teacher"><option value="">Unassigned</option>${teachers.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></label><button class="primary">Save class</button></form>`; $("#class-create").onsubmit = createClass; };
  }
  async function createClass(e) { e.preventDefault(); const f = new FormData(e.target); try { await api(state.db.from("classes").insert({ name:f.get("name"), section:f.get("section"), academic_year:f.get("year"), teacher_id:f.get("teacher") || null })); flash("Class created."); classes(); } catch (err) { flash(err.message, true); } }

  async function teachers() {
    if (!isAdmin()) return navigate("dashboard"); setTemplate("#teachers-template");
    const [profiles, registered] = await Promise.all([api(state.db.from("profiles").select("id,full_name,email").eq("role", "teacher").order("email")), api(state.db.from("teachers").select("id,profile_id,name,phone,profiles(email)").order("name"))]);
    const used = new Set(registered.map(t => t.profile_id)); const available = profiles.filter(p => !used.has(p.id));
    $("#teacher-form").innerHTML = available.length ? `<form id="teacher-create"><label>Account<select name="profile" required><option value="">Select signed-up teacher</option>${available.map(p => `<option value="${p.id}">${esc(p.full_name || p.email)} (${esc(p.email)})</option>`).join("")}</select></label><label>Display name<input name="name" required></label><label>Phone<input name="phone"></label><button class="primary">Activate teacher</button></form>` : `<p class="muted">No unassigned teacher accounts. Ask the teacher to sign up first.</p>`;
    const form = $("#teacher-create"); if (form) form.onsubmit = async e => { e.preventDefault(); const f = new FormData(form); try { await api(state.db.from("teachers").insert({ profile_id:f.get("profile"), name:f.get("name"), phone:f.get("phone") || null })); flash("Teacher profile activated."); teachers(); } catch (err) { flash(err.message, true); } };
    $("#teachers-table").innerHTML = registered.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th></tr></thead><tbody>${registered.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(t.profiles?.email)}</td><td>${esc(t.phone || "—")}</td></tr>`).join("")}</tbody></table></div>` : empty("No teacher profiles activated.");
  }

  async function reports() {
    setTemplate("#reports-template"); await getClasses(); const now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), 1); $("#report-from").value = start.toISOString().slice(0, 10); $("#report-to").value = isoToday(); $("#report-class").innerHTML = classOptions("", "All available classes");
    $("#report-class").onchange = async () => { const classId = $("#report-class").value; const students = await api(state.db.from("students").select("id,name,roll_number").eq("class_id", classId || "00000000-0000-0000-0000-000000000000").order("name")); $("#report-student").innerHTML = `<option value="">All students</option>${students.map(s => `<option value="${s.id}">${esc(s.name)} (${esc(s.roll_number)})</option>`).join("")}`; };
    $("#run-report").onclick = runReport; $("#excel-export").onclick = exportExcel; $("#pdf-export").onclick = () => window.print(); await runReport();
  }
  async function runReport() {
    const from = $("#report-from").value, to = $("#report-to").value, classId = $("#report-class").value, studentId = $("#report-student").value; if (!from || !to || from > to) return flash("Choose a valid date range.", true);
    let q = state.db.from("attendance_sessions").select("id,attendance_date,class_id,classes(name,section)").gte("attendance_date", from).lte("attendance_date", to).order("attendance_date"); if (classId) q = q.eq("class_id", classId); const sessions = await api(q); const ids = sessions.map(s => s.id);
    let records = ids.length ? await api(state.db.from("attendance_records").select("session_id,student_id,status,remarks,students(name,roll_number)").in("session_id", ids)) : []; if (studentId) records = records.filter(r => r.student_id === studentId);
    const bySession = Object.fromEntries(sessions.map(s => [s.id, s])); state.reportRows = records.map(r => ({ date:bySession[r.session_id].attendance_date, class:`${bySession[r.session_id].classes?.name || ""} ${bySession[r.session_id].classes?.section || ""}`.trim(), student:r.students?.name || "", roll:r.students?.roll_number || "", status:r.status, remarks:r.remarks || "" }));
    const present = state.reportRows.filter(r => r.status === "present").length, absent = state.reportRows.filter(r => r.status === "absent").length, leave = state.reportRows.filter(r => r.status === "leave").length; $("#report-summary").innerHTML = `<article><span>Present</span><strong>${present}</strong></article><article><span>Absent</span><strong>${absent}</strong></article><article><span>Leave</span><strong>${leave}</strong></article>`;
    $("#report-table").innerHTML = state.reportRows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Class</th><th>Student</th><th>Roll no.</th><th>Status</th><th>Remarks</th></tr></thead><tbody>${state.reportRows.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.class)}</td><td>${esc(r.student)}</td><td>${esc(r.roll)}</td><td><span class="status ${r.status}">${esc(r.status)}</span></td><td>${esc(r.remarks || "—")}</td></tr>`).join("")}</tbody></table></div>` : empty("No attendance records match this report.");
  }
  function exportExcel() { if (!state.reportRows.length) return flash("Run a report with data before exporting.", true); const sheet = XLSX.utils.json_to_sheet(state.reportRows.map(r => ({ Date:r.date, Class:r.class, Student:r.student, "Roll No.":r.roll, Status:r.status, Remarks:r.remarks }))); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "Attendance"); XLSX.writeFile(book, `attendance-report-${isoToday()}.xlsx`); }

  function init() {
    if (configured) state.db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    $("#auth-form").onsubmit = signIn; $("#signup-button").onclick = signUp; $("#signout").onclick = async () => { await state.db.auth.signOut(); showAuth(); };
    $("#nav").onclick = e => { const button = e.target.closest("button[data-page]"); if (button) navigate(button.dataset.page); }; $("#menu-toggle").onclick = () => $(".sidebar").classList.toggle("open");
    if (configured) loadSession(); else ensureConfigured();
  }
  init();
})();
