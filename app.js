/* Nousomplex Attendance Portal — Complete with all features */
(() => {
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL?.startsWith("https://") && !cfg.SUPABASE_ANON_KEY?.startsWith("PASTE_");
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const content = $("#page-content");
  const state = { 
    db: null, 
    user: null, 
    profile: null, 
    teacher: null, 
    page: "dashboard", 
    classes: [], 
    reportRows: [], 
    reportStudentResults: [], 
    reportDateRange: {}, 
    reportTotalDays: 0, 
    reportTotalHolidays: 0, 
    reportTotalDesignatedDays: 0, 
    recoveryMode: false,
    currentAttendanceDate: null,
    currentAttendanceClass: null,
    allowPastAttendance: true,
    teacherPermissions: null
  };
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  // Format a Date object as YYYY-MM-DD using its LOCAL calendar date.
  // (Date#toISOString() converts to UTC first, which silently rolls the
  // date back by one day for anyone in a positive UTC-offset timezone —
  // e.g. Pakistan, UTC+5 — during the first few hours after local midnight.
  // Every "today" / "this month" calculation in the app must use this.)
  const toLocalISODate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const isoToday = () => toLocalISODate(new Date());
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
  let loadingHidden = false;
  
  function hideLoadingScreen() {
    if (loadingHidden) return;
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.style.display = 'none';
      loadingHidden = true;
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
    loadingHidden = false;
  }

  // --- Cache Management ---
  let cachedClasses = null;
  let sessionLoading = false;
  
  async function getClasses() {
    if (cachedClasses) { state.classes = cachedClasses; return cachedClasses; }
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
    if (teachersTab) teachersTab.style.display = admin ? "" : "none";
    const calendarTab = document.querySelector('[data-page="calendar"]');
    if (calendarTab) calendarTab.style.display = admin ? "" : "none";
    const adminToolsTab = document.querySelector('[data-page="admin-tools"]');
    if (adminToolsTab) adminToolsTab.style.display = admin ? "" : "none";
  }

  // --- API Helper ---
  async function api(run) { 
    const { data, error } = await run; 
    if (error) throw error; 
    return data; 
  }

  // --- Session Management ---
  async function loadSession() {
    if (sessionLoading) return;
    if (state.recoveryMode) { hideLoadingScreen(); return; }
    sessionLoading = true;
    
    try {
      showLoadingScreen('Checking session...');
      
      const { data: { session } } = await state.db.auth.getSession();
      
      if (!session) {
        hideLoadingScreen();
        sessionLoading = false;
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
      
      await loadAdminSettings();
      
      if (teacher && !isAdmin()) {
        await loadTeacherPermissions();
      }
      
      const displayName = state.profile.full_name || state.profile.email;
      $("#user-name").textContent = displayName;
      $("#user-role").textContent = state.profile.role;
      
      $("#auth-screen").classList.add("hidden"); 
      $("#app").classList.remove("hidden");
      $("#menu-toggle-btn")?.classList.remove("is-hidden");
      
      applyRoleVisibility();
      
      const savedPage = localStorage.getItem('nousomplex_last_page');
      if (savedPage && ['dashboard', 'attendance', 'students', 'classes', 'teachers', 'reports', 'calendar', 'admin-tools'].includes(savedPage)) {
        await navigate(savedPage);
      } else {
        await navigate("dashboard");
      }
      
      hideLoadingScreen();
      sessionLoading = false;
      setTimeout(applyRoleVisibility, 100);
      
    } catch (error) {
      console.error('Session loading error:', error);
      hideLoadingScreen();
      sessionLoading = false;
      showAuth();
    }
  }

  // --- Load Teacher Permissions ---
  async function loadTeacherPermissions() {
    try {
      const perm = await api(state.db.from("teacher_attendance_permissions")
        .select("*")
        .eq("teacher_id", state.teacher.id)
        .maybeSingle());
      state.teacherPermissions = perm || {
        can_mark_attendance: true,
        allow_past_dates: true,
        allow_future_dates: false,
        allow_holidays: false
      };
    } catch (e) {
      console.warn('Could not load teacher permissions:', e);
      state.teacherPermissions = {
        can_mark_attendance: true,
        allow_past_dates: true,
        allow_future_dates: false,
        allow_holidays: false
      };
    }
  }

  // --- Load Admin Settings ---
  async function loadAdminSettings() {
    try {
      const settings = await api(state.db.from("admin_settings").select("*").maybeSingle());
      if (settings) {
        state.allowPastAttendance = settings.allow_past_attendance !== false;
      }
    } catch (e) {
      console.warn('Could not load admin settings:', e);
    }
  }

  // --- Save Admin Settings ---
  async function saveAdminSettings(settings) {
    try {
      const existing = await api(state.db.from("admin_settings").select("id").maybeSingle());
      if (existing) {
        await api(state.db.from("admin_settings").update(settings).eq("id", existing.id));
      } else {
        await api(state.db.from("admin_settings").insert(settings));
      }
      state.allowPastAttendance = settings.allow_past_attendance !== false;
      flash("Admin settings saved successfully.");
    } catch (e) {
      flash(e.message, true);
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

  // --- Reset Password ---
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
      
      state.recoveryMode = false;
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
    localStorage.setItem('nousomplex_last_page', page);
    
    document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.page === page));
    $("#page-title").textContent = ({ 
      dashboard:"Dashboard", 
      attendance:"Mark attendance", 
      students:"Students", 
      classes:"Classes", 
      teachers:"Teachers", 
      reports:"Reports & exports",
      calendar:"Calendar",
      "admin-tools":"Admin Tools"
    })[page];
    $("#today").textContent = fmt.format(new Date()); 
    
    try { 
      await ({ 
        dashboard, attendance, students, classes, teachers, reports, calendar, "admin-tools": adminTools
      })[page](); 
      setTimeout(applyRoleVisibility, 100);
      setTimeout(restoreDropdownSelections, 200);
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

  // --- Helper: Check if date is weekend ---
  function isWeekend(dateStr) {
    const d = new Date(dateStr);
    return d.getDay() === 0 || d.getDay() === 6;
  }

  // --- Helper: Check if date is holiday or designated day ---
  async function getDayType(date, classId) {
    const isWeekendDay = isWeekend(date);
    
    // Check if date is a designated day
    let designatedQuery = state.db.from("designated_days").select("id,reason").eq("date", date);
    if (classId) {
      designatedQuery = designatedQuery.eq("class_id", classId);
    } else {
      designatedQuery = designatedQuery.is("class_id", null);
    }
    const designated = await api(designatedQuery);
    const isDesignated = designated.length > 0;
    
    // Check if date is a holiday
    let holidayQuery = state.db.from("holidays").select("id,reason").eq("date", date);
    if (classId) {
      holidayQuery = holidayQuery.eq("class_id", classId);
    } else {
      holidayQuery = holidayQuery.is("class_id", null);
    }
    const holidays = await api(holidayQuery);
    const isHoliday = holidays.length > 0;
    
    // Priority: Holiday > Designated > Weekend > Normal
    // If a date is marked as holiday, it's a holiday regardless of designated status
    if (isHoliday) {
      return { type: 'holiday', reason: holidays[0].reason || 'Holiday' };
    }
    
    if (isDesignated) {
      return { type: 'designated', reason: designated[0].reason || 'Designated Day' };
    }
    
    if (isWeekendDay) {
      return { type: 'weekend', reason: 'Weekend' };
    }
    
    return { type: 'normal', reason: '' };
  }

  // --- Helper: Check if date is holiday (for attendance marking) ---
  async function checkIfHolidayOrWeekend(date, classId) {
    const dayType = await getDayType(date, classId);
    return dayType.type === 'holiday' || dayType.type === 'weekend';
  }

  // --- Attendance ---
  async function attendance() {
    setTemplate("#attendance-template"); 
    await getClasses(); 
    const savedDate = localStorage.getItem('nousomplex_attendance_date') || isoToday();
    const savedClass = localStorage.getItem('nousomplex_attendance_class') || "";
    
    const admin = isAdmin();
    const isTeacher = !admin && state.teacher;
    
    let canMarkAttendance = admin;
    if (isTeacher && state.teacherPermissions) {
      canMarkAttendance = state.teacherPermissions.can_mark_attendance !== false;
    }
    
    $("#attendance-date").value = savedDate; 
    $("#attendance-class").innerHTML = classOptions(savedClass);
    $("#load-roster").onclick = loadRoster; 
    $("#save-attendance").onclick = saveAttendance;
    
    const attendanceUI = document.getElementById('attendance-ui');
    const restrictedMsg = document.getElementById('attendance-restricted-message');
    
    if (!canMarkAttendance) {
      if (attendanceUI) attendanceUI.style.display = 'none';
      if (restrictedMsg) {
        restrictedMsg.style.display = 'block';
        restrictedMsg.innerHTML = `
          <div class="panel" style="background:#fef2f2;border:1px solid #fecaca;padding:20px;border-radius:8px;text-align:center;">
            <p style="color:#991b1b;font-weight:600;margin:0;">⚠️ You are not authorized to mark attendance. Please contact the administrator.</p>
          </div>
        `;
      }
      $("#load-roster").disabled = true;
      $("#save-attendance").disabled = true;
      applyRoleVisibility();
      return;
    } else {
      if (attendanceUI) attendanceUI.style.display = 'block';
      if (restrictedMsg) restrictedMsg.style.display = 'none';
      $("#load-roster").disabled = false;
    }
    
    applyRoleVisibility();
    
    if (savedClass && canMarkAttendance) {
      setTimeout(() => loadRoster(), 300);
    }
  }

  async function loadRoster() {
    const classId = $("#attendance-class").value;
    const date = $("#attendance-date").value;
    
    localStorage.setItem('nousomplex_attendance_date', date);
    localStorage.setItem('nousomplex_attendance_class', classId);
    state.currentAttendanceDate = date;
    state.currentAttendanceClass = classId;
    
    if (!classId || !date) return flash("Choose a class and date.", true);
    
    const admin = isAdmin();
    const isTeacher = !admin && state.teacher;
    
    let canMarkAttendance = admin;
    let allowPastDates = admin;
    let allowFutureDates = admin;
    let allowHolidays = admin;
    
    if (isTeacher && state.teacherPermissions) {
      const perm = state.teacherPermissions;
      canMarkAttendance = perm.can_mark_attendance !== false;
      allowPastDates = perm.allow_past_dates !== false;
      allowFutureDates = perm.allow_future_dates === true;
      allowHolidays = perm.allow_holidays === true;
    } else if (isTeacher) {
      canMarkAttendance = true;
      allowPastDates = true;
      allowFutureDates = false;
      allowHolidays = false;
    }
    
    if (isTeacher && !canMarkAttendance) {
      flash("⚠️ You are not authorized to mark attendance.", true);
      $("#roster").innerHTML = empty("You are not authorized to mark attendance. Please contact the administrator.");
      $("#save-attendance").disabled = true;
      return;
    }
    
    const isPastDate = date < isoToday();
    const isFutureDate = date > isoToday();
    
    if (isTeacher) {
      if (isPastDate && !allowPastDates) {
        flash("⚠️ Marking attendance for past dates is restricted for you.", true);
        $("#roster").innerHTML = empty("You are not allowed to mark attendance for past dates.");
        $("#save-attendance").disabled = true;
        return;
      }
      if (isFutureDate && !allowFutureDates) {
        flash("⚠️ Marking attendance for future dates is restricted for you.", true);
        $("#roster").innerHTML = empty("You are not allowed to mark attendance for future dates.");
        $("#save-attendance").disabled = true;
        return;
      }
    }
    
    const dayType = await getDayType(date, classId);
    const isHolidayOrWeekend = dayType.type === 'holiday' || dayType.type === 'weekend';
    const isDesignated = dayType.type === 'designated';
    
    if (isTeacher && isHolidayOrWeekend && !allowHolidays && !isDesignated) {
      flash("⚠️ Attendance cannot be marked on holidays or weekends.", true);
      $("#roster").innerHTML = empty("Attendance cannot be marked on holidays or weekends.");
      $("#save-attendance").disabled = true;
      return;
    }
    
    const existingSession = await api(state.db.from("attendance_sessions").select("id,created_at").eq("class_id", classId).eq("attendance_date", date).maybeSingle());
    const isExisting = !!existingSession;
    
    // A teacher who is not allowed to make changes to an already-marked
    // session should not see the marked attendance at all — do not fetch
    // or render it, just show a locked message and stop here.
    if (isExisting && isTeacher) {
      flash("⚠️ Attendance has already been marked for this class on this date. Changes are not allowed.", true);
      $("#roster").innerHTML = `
        <div class="panel" style="background:#fef2f2;border:1px solid #fecaca;padding:20px;border-radius:8px;text-align:center;">
          <p style="color:#991b1b;font-weight:600;margin:0;">🔒 Attendance for this class and date has already been marked.</p>
          <p style="color:#991b1b;margin:8px 0 0;font-size:14px;">You are not permitted to view or change it. Contact the administrator if a correction is needed.</p>
        </div>`;
      $("#save-attendance").disabled = true;
      return;
    }
    
    const students = await api(state.db.from("students").select("id,name,roll_number").eq("class_id", classId).eq("active", true).order("roll_number"));
    const session = existingSession || await api(state.db.from("attendance_sessions").select("id").eq("class_id", classId).eq("attendance_date", date).maybeSingle());
    const existing = session ? await api(state.db.from("attendance_records").select("student_id,status,remarks").eq("session_id", session.id)) : [];
    const map = Object.fromEntries(existing.map(r => [r.student_id, r]));
    
    const canMarkPast = isAdmin() || state.allowPastAttendance;
    const canEdit = admin || (!isExisting && (!isPastDate || canMarkPast));
    
    if (isPastDate && isTeacher && !allowPastDates) {
      flash("⚠️ Marking attendance for past dates is restricted by admin.", true);
    }
    
    // Show day type info
    let dayTypeInfo = '';
    if (isDesignated) {
      dayTypeInfo = `<div style="background:#dbeafe;border:1px solid #3b82f6;padding:10px;border-radius:6px;margin-bottom:10px;color:#1e40af;">
        📌 This date is marked as a <strong>Designated Day</strong>: ${esc(dayType.reason)}
      </div>`;
    } else if (isHolidayOrWeekend) {
      dayTypeInfo = `<div style="background:#fef3c7;border:1px solid #f59e0b;padding:10px;border-radius:6px;margin-bottom:10px;color:#92400e;">
        📅 This date is a <strong>${dayType.type === 'holiday' ? 'Holiday' : 'Weekend'}</strong>${dayType.reason ? ': ' + esc(dayType.reason) : ''}
      </div>`;
    }
    
    $("#roster").innerHTML = students.length ? 
      `${dayTypeInfo}<div class="table-wrap"><table><thead><tr><th>Roll no.</th><th>Student</th><th>Status</th><th>Remarks</th>${admin ? '<th>Actions</th>' : ''}</tr></thead><tbody>${students.map(s => { 
        const r = map[s.id] || { status:"present", remarks:"" }; 
        const statuses = ['present', 'absent', 'leave'];
        const statusLabels = { present: 'Present', absent: 'Absent', leave: 'Leave' };
        const disabled = isExisting && !admin;
        return `<tr data-student="${s.id}" data-status="${r.status}">
          <td>${esc(s.roll_number)}</td>
          <td>${esc(s.name)}</td>
          <td>
            <select class="status-select" ${disabled ? 'disabled' : ''}>
              ${statuses.map(st => `<option value="${st}" ${r.status === st ? "selected" : ""}>${statusLabels[st]}</option>`).join("")}
            </select>
          </td>
          <td><input class="remarks" value="${esc(r.remarks || "")}" maxlength="250" ${disabled ? 'disabled' : ''}></td>
          ${admin ? `<td><button class="text-button edit-record" type="button" style="color:#4f46e5;">Edit</button></td>` : ''}
        </tr>`; 
      }).join("")}</tbody></table></div>` : 
      empty("No active students exist in this class.");
    
    // Can save if admin OR (not existing AND (not past date OR can mark past) AND (not holiday/weekend OR is designated))
    const canSave = admin || (!isExisting && (!isPastDate || canMarkPast) && (!isHolidayOrWeekend || isDesignated));
    $("#save-attendance").disabled = !students.length || !canSave;
    
    if (admin) {
      $$(".edit-record").forEach(btn => {
        btn.onclick = function() {
          const tr = this.closest('tr');
          const studentId = tr.dataset.student;
          const currentStatus = tr.dataset.status || 'present';
          showStatusEditModal(studentId, currentStatus, date, classId);
        };
      });
      
      $$(".status-select").forEach(sel => {
        sel.onchange = function() {
          const tr = this.closest('tr');
          const newStatus = this.value;
          const studentId = tr.dataset.student;
          tr.dataset.status = newStatus;
          tr.style.background = '#fef3c7';
          setTimeout(() => { tr.style.background = ''; }, 2000);
        };
      });
    }
    
    applyRoleVisibility();
  }

  // --- Edit Status Modal ---
  function showStatusEditModal(studentId, currentStatus, date, classId) {
    const modal = document.createElement('div');
    modal.className = 'reset-modal show';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:400px;">
        <h2 style="margin-top:0;">Edit Attendance Status</h2>
        <p style="color:#6b7280;font-size:14px;">Change the attendance status for this student.</p>
        <div style="margin:15px 0;">
          <label style="display:block;font-weight:500;margin-bottom:5px;">Current Status: <strong>${currentStatus}</strong></label>
          <label style="display:block;font-weight:500;margin-bottom:5px;">New Status:</label>
          <select id="edit-status-select" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;">
            <option value="present" ${currentStatus === 'present' ? 'selected' : ''}>Present</option>
            <option value="absent" ${currentStatus === 'absent' ? 'selected' : ''}>Absent</option>
            <option value="leave" ${currentStatus === 'leave' ? 'selected' : ''}>Leave</option>
          </select>
        </div>
        <div class="toolbar" style="margin-top:10px;">
          <button id="edit-status-confirm" class="primary" style="flex:1;">Update Status</button>
          <button id="edit-status-cancel" class="secondary" style="flex:1;">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#edit-status-confirm').onclick = async function() {
      const newStatus = modal.querySelector('#edit-status-select').value;
      try {
        await updateAttendanceStatus(studentId, date, classId, newStatus);
        flash(`Attendance status updated to ${newStatus}.`);
        modal.remove();
        await loadRoster();
      } catch (err) {
        flash(err.message, true);
      }
    };

    modal.querySelector('#edit-status-cancel').onclick = function() {
      modal.remove();
    };

    modal.onclick = function(e) {
      if (e.target === modal) modal.remove();
    };
  }

  async function updateAttendanceStatus(studentId, date, classId, newStatus) {
    let session = await api(state.db.from("attendance_sessions").select("id").eq("class_id", classId).eq("attendance_date", date).maybeSingle());
    if (!session) {
      session = await api(state.db.from("attendance_sessions").insert({ class_id: classId, attendance_date: date }).select("id").single());
    }
    
    await api(state.db.from("attendance_records").upsert({
      session_id: session.id,
      student_id: studentId,
      status: newStatus,
      remarks: null
    }, { onConflict: "session_id,student_id" }));
  }

  async function saveAttendance() {
    const classId = $("#attendance-class").value;
    const date = $("#attendance-date").value;
    if (!classId || !date) return;
    
    const admin = isAdmin();
    const isTeacher = !admin && state.teacher;
    
    let canMarkAttendance = admin;
    let allowPastDates = admin;
    let allowHolidays = admin;
    
    if (isTeacher && state.teacherPermissions) {
      canMarkAttendance = state.teacherPermissions.can_mark_attendance !== false;
      allowPastDates = state.teacherPermissions.allow_past_dates !== false;
      allowHolidays = state.teacherPermissions.allow_holidays === true;
    }
    
    if (isTeacher && !canMarkAttendance) {
      flash("⚠️ You are not authorized to mark attendance.", true);
      return;
    }
    
    const existingSession = await api(state.db.from("attendance_sessions").select("id").eq("class_id", classId).eq("attendance_date", date).maybeSingle());
    const isPastDate = date < isoToday();
    const canMarkPast = admin || state.allowPastAttendance;
    
    const dayType = await getDayType(date, classId);
    const isHolidayOrWeekend = dayType.type === 'holiday' || dayType.type === 'weekend';
    const isDesignated = dayType.type === 'designated';
    
    if (isTeacher && isHolidayOrWeekend && !allowHolidays && !isDesignated) {
      flash("⚠️ Attendance cannot be marked on holidays or weekends.", true);
      return;
    }
    
    if (isTeacher && existingSession) {
      flash("⚠️ Attendance already marked for this class on this date. Changes are not allowed.", true);
      return;
    }
    if (isTeacher && isPastDate && !allowPastDates) {
      flash("⚠️ Marking attendance for past dates is restricted for you.", true);
      return;
    }
    
    try {
      let session = existingSession;
      if (!session) {
        session = await api(state.db.from("attendance_sessions").insert({ class_id: classId, attendance_date: date }).select("id").single());
      }
      
      const records = [...document.querySelectorAll("#roster tbody tr")].map(row => ({ 
        session_id: session.id, 
        student_id: row.dataset.student, 
        status: $(".status-select", row).value, 
        remarks: $(".remarks", row).value.trim() || null 
      }));
      
      await api(state.db.from("attendance_records").upsert(records, { onConflict:"session_id,student_id" })); 
      flash("Attendance saved successfully.");
      await loadRoster();
    } catch (e) { flash(e.message, true); }
  }

  // --- Students ---
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
    try { 
      await api(state.db.from("students").update({ active: !currentActive }).eq("id", id)); 
      flash(!currentActive ? "Student enabled — visible to teachers again." : "Student disabled — hidden from teachers and attendance marking."); 
      students(); 
    } catch (err) { flash(err.message, true); }
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
      await api(state.db.from("students").insert({ name:f.get("name"), roll_number:f.get("roll"), class_id:f.get("class"), email:f.get("email") || null, phone:f.get("phone") || null })); 
      flash("Student registered."); 
      students(); 
    } catch (err) { flash(err.message, true); } 
  }

  async function updateStudent(e, id) { 
    e.preventDefault(); 
    const f = new FormData(e.target); 
    try { 
      await api(state.db.from("students").update({ name:f.get("name"), roll_number:f.get("roll"), class_id:f.get("class"), email:f.get("email") || null, phone:f.get("phone") || null }).eq("id", id)); 
      flash("Student updated."); 
      students(); 
    } catch (err) { flash(err.message, true); } 
  }

  async function deleteStudent(id) {
    if (!confirm("Delete this student? This cannot be undone.")) return;
    try { await api(state.db.from("students").delete().eq("id", id)); flash("Student deleted."); students(); }
    catch (err) { flash(/foreign key|violat/i.test(err.message) ? "This student has attendance history and cannot be deleted." : err.message, true); }
  }

  // --- Classes ---
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
      await api(state.db.from("classes").insert({ name:f.get("name"), section:f.get("section"), academic_year:f.get("year"), teacher_id:f.get("teacher") || null })); 
      flash("Class created."); 
      classes(); 
    } catch (err) { flash(err.message, true); } 
  }

  async function updateClass(e, id) { 
    e.preventDefault(); 
    const f = new FormData(e.target); 
    try { 
      await api(state.db.from("classes").update({ name:f.get("name"), section:f.get("section"), academic_year:f.get("year"), teacher_id:f.get("teacher") || null }).eq("id", id)); 
      flash("Class updated."); 
      classes(); 
    } catch (err) { flash(err.message, true); } 
  }

  async function deleteClass(id) {
    if (!confirm("Delete this class? This cannot be undone.")) return;
    try { await api(state.db.from("classes").delete().eq("id", id)); flash("Class deleted."); classes(); }
    catch (err) { flash(/foreign key|violat/i.test(err.message) ? "This class still has students assigned and cannot be deleted." : err.message, true); }
  }

  // --- Teachers ---
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

  // --- Dropdown Selections Persistence ---
  function saveDropdownSelections() {
    const selections = {};
    document.querySelectorAll('select').forEach(select => {
      if (select.id) {
        selections[select.id] = select.value;
      }
    });
    localStorage.setItem('nousomplex_dropdown_selections', JSON.stringify(selections));
  }

  function restoreDropdownSelections() {
    const saved = localStorage.getItem('nousomplex_dropdown_selections');
    if (saved) {
      try {
        const selections = JSON.parse(saved);
        Object.keys(selections).forEach(id => {
          const select = document.getElementById(id);
          if (select) {
            // Don't restore date inputs - they should be fixed
            if (select.id === 'report-from' || select.id === 'report-to') {
              return;
            }
            // Check if the value exists in the select options
            const optionExists = Array.from(select.options).some(opt => opt.value === selections[id]);
            if (optionExists) {
              select.value = selections[id];
            }
          }
        });
        // Re-apply the report view (summary / detail / both) after restoring
        // the saved dropdown value — otherwise the visible sections keep
        // showing whatever was rendered before the restore ran and no
        // longer match the "Show" dropdown.
        if (document.getElementById('report-view')) {
          applyReportView();
          // Also re-run the report if we have data to show the correct details
          if (state.reportStudentResults && state.reportStudentResults.length > 0) {
            setTimeout(runReport, 100);
          }
        }
      } catch (e) {
        console.warn('Could not restore dropdown selections:', e);
      }
    }
  }

  // --- Reports ---
  async function reports() {
    setTemplate("#reports-template"); 
    await getClasses(); 
    
    // ALWAYS set to 1st of current month for from date and today for to date
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const fromDate = toLocalISODate(firstDay);
    const toDate = isoToday();
    
    document.getElementById("report-from").value = fromDate;
    document.getElementById("report-to").value = toDate;
    
    // Store in localStorage for reference but dates will always reset on page load
    localStorage.setItem('nousomplex_report_from', fromDate);
    localStorage.setItem('nousomplex_report_to', toDate);
    
    document.getElementById("report-from").onchange = function() {
      localStorage.setItem('nousomplex_report_from', this.value);
      saveDropdownSelections();
    };
    document.getElementById("report-to").onchange = function() {
      localStorage.setItem('nousomplex_report_to', this.value);
      saveDropdownSelections();
    };
    
    $("#report-class").innerHTML = classOptions("", "All available classes", true);
    $("#report-class").onchange = async () => { 
      const classId = $("#report-class").value; 
      const students = await api(state.db.from("students").select("id,name,roll_number").eq("class_id", classId || "00000000-0000-0000-0000-000000000000").order("roll_number")); 
      $("#report-student").innerHTML = `<option value="">All students</option>${students.map(s => `<option value="${s.id}">${esc(s.roll_number)} — ${esc(s.name)}</option>`).join("")}`; 
      saveDropdownSelections();
      if (document.getElementById('report-student').value) {
        await runReport();
      }
    };
    const allowExport = isAdmin() || state.teacher?.can_export !== false;
    $$(".export-only").forEach(el => el.classList.toggle("hidden", !allowExport));
    $("#export-restricted-note")?.classList.toggle("hidden", allowExport);
    $("#run-report").onclick = runReport; 
    $("#excel-export-both").onclick = () => exportExcel("both"); 
    $("#excel-export-summary").onclick = () => exportExcel("summary"); 
    $("#excel-export-detail").onclick = () => exportExcel("detail"); 
    $("#pdf-export").onclick = () => { if (allowExport) exportPDF(); }; 
    $("#report-view").onchange = function() { 
      applyReportView();
      saveDropdownSelections();
      // Re-run report when view changes to ensure data is fresh
      if (state.reportStudentResults && state.reportStudentResults.length > 0) {
        setTimeout(runReport, 100);
      }
    };
    
    // Run the report first
    await runReport();
    
    // Set default view
    $("#report-view").value = "summary";
    applyReportView();
    
    // Restore dropdown selections AFTER data is loaded
    setTimeout(() => {
      restoreDropdownSelections();
      // Force re-apply report view after restore
      if (document.getElementById('report-view')) {
        applyReportView();
        // Re-run report to show data for restored selections
        setTimeout(runReport, 200);
      }
    }, 300);
  }

  function getDateRangeArray(from, to) {
    const dates = [];
    const current = new Date(from);
    const end = new Date(to);
    while (current <= end) {
      dates.push(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  async function runReport() {
    const from = document.getElementById('report-from').value;
    const to = document.getElementById('report-to').value;
    const classId = document.getElementById('report-class').value;
    const studentId = document.getElementById('report-student').value;
    
    if (!from || !to || from > to) return flash("Choose a valid date range.", true);
    
    await getClasses();
    
    const allDates = getDateRangeArray(from, to);
    const totalDaysInRange = allDates.length;
    
    // Get all holidays and designated days for the date range
    let holidayQuery = state.db.from("holidays").select("date,class_id").gte("date", from).lte("date", to);
    if (classId) holidayQuery = holidayQuery.eq("class_id", classId);
    const holidays = await api(holidayQuery);
    const holidayDates = new Set(holidays.map(h => h.date));
    
    let designatedQuery = state.db.from("designated_days").select("date,class_id").gte("date", from).lte("date", to);
    if (classId) designatedQuery = designatedQuery.eq("class_id", classId);
    const designatedDays = await api(designatedQuery);
    const designatedDates = new Set(designatedDays.map(d => d.date));
    
    // Calculate holidays and designated days
    // Priority: Holiday > Designated > Weekend > Normal
    let totalHolidays = 0;
    let totalDesignatedDays = 0;
    const dateTypeMap = {};
    
    allDates.forEach(date => {
      const isWeekendDay = isWeekend(date);
      const isHolidayDay = holidayDates.has(date);
      const isDesignatedDay = designatedDates.has(date);
      
      // Holiday takes priority over everything
      if (isHolidayDay) {
        totalHolidays++;
        dateTypeMap[date] = 'holiday';
      } 
      // Designated day (only if not a holiday)
      else if (isDesignatedDay) {
        totalDesignatedDays++;
        dateTypeMap[date] = 'designated';
      } 
      // Weekend (only if not a holiday or designated)
      else if (isWeekendDay) {
        totalHolidays++;
        dateTypeMap[date] = 'weekend';
      } 
      // Normal day
      else {
        totalDesignatedDays++;
        dateTypeMap[date] = 'normal';
      }
    });
    
    const totalDesignatedDaysCount = totalDesignatedDays;
    
    let studentQuery = state.db.from("students").select("id,name,roll_number,class_id,classes(name,section)").eq("active", true);
    if (classId) studentQuery = studentQuery.eq("class_id", classId);
    const students = await api(studentQuery.order("roll_number"));
    
    const filteredStudents = studentId ? students.filter(s => s.id === studentId) : students;
    
    let sessionQuery = state.db.from("attendance_sessions").select("id,attendance_date,class_id")
      .gte("attendance_date", from).lte("attendance_date", to);
    if (classId) sessionQuery = sessionQuery.eq("class_id", classId);
    const sessions = await api(sessionQuery);
    const sessionIds = sessions.map(s => s.id);
    
    let records = sessionIds.length ? await api(state.db.from("attendance_records")
      .select("id,session_id,student_id,status,remarks")
      .in("session_id", sessionIds)) : [];
    if (studentId) records = records.filter(r => r.student_id === studentId);
    
    const studentResults = filteredStudents.map(student => {
      const studentRecords = records.filter(r => r.student_id === student.id);
      const recordMap = {};
      studentRecords.forEach(r => {
        const session = sessions.find(s => s.id === r.session_id);
        if (session) recordMap[session.attendance_date] = r.status;
      });
      
      let studentHolidayCount = 0;
      let studentDesignatedCount = 0;
      let designatedDaysCount = 0;
      let presentCount = 0;
      let absentCount = 0;
      let leaveCount = 0;
      
      allDates.forEach(date => {
        const dayType = dateTypeMap[date] || 'normal';
        const status = recordMap[date];
        
        if (dayType === 'holiday' || dayType === 'weekend') {
          studentHolidayCount++;
        } else {
          // Designated or normal day - counts towards attendance
          studentDesignatedCount++;
          designatedDaysCount++;
          if (status === 'present') presentCount++;
          else if (status === 'absent') absentCount++;
          else if (status === 'leave') leaveCount++;
        }
      });
      
      // Attendance percentage is based on designated days (normal + designated days)
      const attendancePercentage = designatedDaysCount > 0 ? Math.round((presentCount / designatedDaysCount) * 100) : 0;
      
      return {
        id: student.id,
        name: student.name,
        roll: student.roll_number || 'N/A',
        class: student.classes ? `${student.classes.name}${student.classes.section ? ` — ${student.classes.section}` : ''}` : 'N/A',
        totalDays: totalDaysInRange,
        holidayCount: studentHolidayCount,
        designatedDays: designatedDaysCount,
        presentCount: presentCount,
        absentCount: absentCount,
        leaveCount: leaveCount,
        attendancePercentage: attendancePercentage
      };
    });
    
    state.reportStudentResults = studentResults;
    state.reportDateRange = { from, to };
    state.reportTotalDays = totalDaysInRange;
    state.reportTotalHolidays = totalHolidays;
    state.reportTotalDesignatedDays = totalDesignatedDaysCount;
    
    state.reportRows = records.map(r => {
      const session = sessions.find(s => s.id === r.session_id);
      const student = students.find(s => s.id === r.student_id);
      return {
        id: r.id,
        date: session?.attendance_date || '',
        class: session?.class_id ? (state.classes.find(c => c.id === session.class_id)?.name || '') : '',
        student: student?.name || '',
        roll: student?.roll_number || '',
        status: r.status || '',
        remarks: r.remarks || ''
      };
    });
    state.reportRows.sort((a, b) => (a.roll || '').localeCompare(b.roll || '', undefined, { numeric: true }));
    
    const totalStudents = studentResults.length;
    const totalPresent = studentResults.reduce((sum, s) => sum + s.presentCount, 0);
    const totalAbsent = studentResults.reduce((sum, s) => sum + s.absentCount, 0);
    const totalLeave = studentResults.reduce((sum, s) => sum + s.leaveCount, 0);
    // Sum designated days ACROSS ALL STUDENTS (not just the per-date-range count),
    // since each student contributes their own designated-days total. Previously this
    // divided totalPresent (summed across all students) by a single student's designated
    // days count, inflating the percentage far past 100% for multi-student reports.
    const totalDesignatedDaysAllStudents = studentResults.reduce((sum, s) => sum + s.designatedDays, 0);
    const overallAttendance = totalDesignatedDaysAllStudents > 0 ? Math.round((totalPresent / totalDesignatedDaysAllStudents) * 100) : 0;
    
    document.getElementById('report-summary').innerHTML = `
      <article><span>Total Students</span><strong>${totalStudents}</strong></article>
      <article><span>Total Days</span><strong>${totalDaysInRange}</strong></article>
      <article><span>Holidays</span><strong>${totalHolidays}</strong></article>
      <article><span>Designated Days</span><strong>${totalDesignatedDaysCount}</strong></article>
      <article><span>Present</span><strong>${totalPresent}</strong></article>
      <article><span>Absent</span><strong>${totalAbsent}</strong></article>
      <article><span>Leave</span><strong>${totalLeave}</strong></article>
      <article><span>Attendance %</span><strong>${overallAttendance}%</strong></article>
    `;
    
    const summaryEl = document.getElementById('student-summary-table');
    if (summaryEl) {
      summaryEl.innerHTML = studentResults.length ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Roll No.</th>
                <th>Student</th>
                <th>Class</th>
                <th>Total Days</th>
                <th>Holidays</th>
                <th>Designated Days</th>
                <th>Present</th>
                <th>Absent</th>
                <th>Leave</th>
                <th>Attendance %</th>
              </tr>
            </thead>
            <tbody>
              ${studentResults.map(s => `
                <tr>
                  <td>${esc(s.roll)}</td>
                  <td>${esc(s.name)}</td>
                  <td>${esc(s.class)}</td>
                  <td>${s.totalDays}</td>
                  <td>${s.holidayCount}</td>
                  <td>${s.designatedDays}</td>
                  <td style="color:#166534;font-weight:600;">${s.presentCount}</td>
                  <td style="color:#991b1b;">${s.absentCount}</td>
                  <td style="color:#92400e;">${s.leaveCount}</td>
                  <td><strong style="color:${s.attendancePercentage >= 75 ? '#166534' : '#991b1b'};">${s.attendancePercentage}%</strong></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : empty("No students found.");
    }
    
    const detailEl = document.getElementById('report-table');
    if (detailEl) {
      if (state.reportRows.length > 0) {
        let displayRows = state.reportRows;
        if (studentId) {
          const selectedStudent = filteredStudents[0];
          if (selectedStudent) {
            displayRows = state.reportRows.filter(r => r.student === selectedStudent.name);
          }
        }
        
        if (displayRows.length > 0) {
          detailEl.innerHTML = `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Roll No.</th>
                    <th>Student</th>
                    <th>Date</th>
                    <th>Class</th>
                    <th>Status</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  ${displayRows.map(r => `
                    <tr>
                      <td>${esc(r.roll)}</td>
                      <td>${esc(r.student)}</td>
                      <td>${esc(r.date)}</td>
                      <td>${esc(r.class)}</td>
                      <td><span class="status ${r.status}">${esc(r.status || '—')}</span></td>
                      <td>${esc(r.remarks || "—")}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          `;
        } else {
          detailEl.innerHTML = empty("No detailed records found for the selected student.");
        }
      } else {
        detailEl.innerHTML = empty("No attendance records match this report.");
      }
    }
    
    applyReportView();
  }

  function applyReportView() {
    const view = $("#report-view")?.value || "summary";
    const summarySection = document.getElementById('summary-section');
    const detailSection = document.getElementById('detail-section');
    
    if (summarySection) {
      summarySection.style.display = (view === "summary" || view === "both") ? "" : "none";
    }
    if (detailSection) {
      detailSection.style.display = (view === "detail" || view === "both") ? "" : "none";
    }
  }

  function exportExcel(mode = "both") {
    if (!state.reportStudentResults || state.reportStudentResults.length === 0) {
      return flash("Run a report with data before exporting.", true);
    }
    if (!(isAdmin() || state.teacher?.can_export !== false)) {
      return flash("Report downloads are disabled for your account.", true);
    }
    const book = XLSX.utils.book_new();
    
    const summaryData = state.reportStudentResults.map(s => ({
      "Roll No.": s.roll,
      "Student": s.name,
      "Class": s.class,
      "Total Days": s.totalDays,
      "Holidays": s.holidayCount,
      "Designated Days": s.designatedDays,
      "Present": s.presentCount,
      "Absent": s.absentCount,
      "Leave": s.leaveCount,
      "Attendance %": s.attendancePercentage + '%'
    }));
    
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(summaryData), "Summary");
    
    if (mode === "both" || mode === "detail") {
      let detailRows = state.reportRows;
      const studentId = document.getElementById('report-student')?.value;
      if (studentId) {
        const student = state.reportStudentResults.find(s => s.id === studentId);
        if (student) {
          detailRows = state.reportRows.filter(r => r.student === student.name);
        }
      }
      
      const detailData = detailRows.map(r => ({
        "Roll No.": r.roll,
        "Student": r.student,
        "Date": r.date,
        "Class": r.class,
        "Status": r.status || '—',
        "Remarks": r.remarks || '—'
      }));
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(detailData), "Detailed");
    }
    
    const suffix = mode === "both" ? "" : `-${mode}`;
    XLSX.writeFile(book, `attendance-report${suffix}-${isoToday()}.xlsx`);
  }

  // --- PDF Export ---
  function exportPDF() {
    if (!state.reportStudentResults || state.reportStudentResults.length === 0) {
      return flash("Run a report with data before exporting.", true);
    }
    if (!(isAdmin() || state.teacher?.can_export !== false)) {
      return flash("Report downloads are disabled for your account.", true);
    }
    
    const viewMode = document.getElementById('report-view')?.value || 'summary';
    const includeSummary = viewMode === 'summary' || viewMode === 'both';
    const includeDetail = viewMode === 'detail' || viewMode === 'both';
    
    const results = state.reportStudentResults;
    const { from, to } = state.reportDateRange || {};
    const classFilter = document.getElementById('report-class')?.value || '';
    const className = classFilter ? state.classes.find(c => c.id === classFilter)?.name || '' : 'All Classes';
    const studentId = document.getElementById('report-student')?.value;
    const studentName = studentId ? results.find(s => s.id === studentId)?.name || '' : 'All Students';
    
    const totalDesignatedDays = state.reportTotalDesignatedDays || results.reduce((sum, s) => sum + s.designatedDays, 0);
    const totalPresent = results.reduce((sum, s) => sum + s.presentCount, 0);
    const totalAbsent = results.reduce((sum, s) => sum + s.absentCount, 0);
    const totalLeave = results.reduce((sum, s) => sum + s.leaveCount, 0);
    const overallAttendance = totalDesignatedDays > 0 ? Math.round((totalPresent / totalDesignatedDays) * 100) : 0;
    
    let detailRows = state.reportRows;
    if (studentId) {
      const student = results.find(s => s.id === studentId);
      if (student) {
        detailRows = state.reportRows.filter(r => r.student === student.name);
      }
    }
    
    let html = `
      <!DOCTYPE html><html><head><meta charset="utf-8"><title>Attendance Report</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; padding: 30px; color: #1a1a2e; max-width: 1100px; margin: 0 auto; background: #ffffff; }
        .header { text-align: center; border-bottom: 3px solid #1a1a2e; padding-bottom: 15px; margin-bottom: 20px; }
        .header h1 { font-size: 32px; color: #1a1a2e; margin: 0; font-weight: 800; letter-spacing: 1px; }
        .header h2 { font-weight: 400; color: #6b7280; margin: 5px 0 0 0; font-size: 18px; }
        .header p { color: #9ca3af; font-size: 13px; margin: 5px 0 0 0; }
        .report-meta { display: flex; justify-content: space-between; flex-wrap: wrap; background: #f8fafc; padding: 15px 20px; border-radius: 8px; margin-bottom: 20px; font-size: 13px; border: 1px solid #e5e7eb; }
        .report-meta .meta-item { margin: 3px 0; }
        .report-meta .meta-item strong { color: #1a1a2e; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 25px; }
        .stats-grid .stat-box { background: #f8fafc; padding: 12px 15px; border-radius: 8px; text-align: center; border: 1px solid #e5e7eb; }
        .stats-grid .stat-box .number { font-size: 22px; font-weight: bold; color: #1a1a2e; display: block; }
        .stats-grid .stat-box .label { font-size: 12px; color: #6b7280; display: block; margin-top: 2px; }
        .stats-grid .stat-box.highlight { background: #eef2ff; border-color: #1a1a2e; }
        .stats-grid .stat-box.highlight .number { color: #1a1a2e; }
        .stats-grid .stat-box.green { background: #f0fdf4; border-color: #86efac; }
        .stats-grid .stat-box.green .number { color: #166534; }
        .stats-grid .stat-box.red { background: #fef2f2; border-color: #fca5a5; }
        .stats-grid .stat-box.red .number { color: #991b1b; }
        .stats-grid .stat-box.yellow { background: #fefce8; border-color: #fde047; }
        .stats-grid .stat-box.yellow .number { color: #854d0e; }
        .section-title { font-size: 18px; color: #1a1a2e; margin: 25px 0 12px 0; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
        table th { background: #f1f5f9; color: #1a1a2e; font-weight: 600; padding: 8px 10px; text-align: left; border-bottom: 2px solid #e2e8f0; }
        table td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
        table tr:nth-child(even) { background: #fafafa; }
        .footer { text-align: center; color: #9ca3af; font-size: 12px; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 15px; }
        .footer p { margin: 3px 0; }
        .pct-high { color: #166534; font-weight: bold; }
        .pct-low { color: #991b1b; font-weight: bold; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 500; }
        .badge.present { background: #dcfce7; color: #166534; }
        .badge.absent { background: #fef2f2; color: #991b1b; }
        .badge.leave { background: #fef3c7; color: #92400e; }
        @media print { body { padding: 15px; } .stats-grid .stat-box { break-inside: avoid; } table { page-break-inside: auto; } tr { page-break-inside: avoid; } }
        @media (max-width: 600px) { body { padding: 10px; } .stats-grid { grid-template-columns: 1fr 1fr; } .report-meta { flex-direction: column; gap: 5px; } }
      </style>
      </head><body>
        <div class="header"><h1>Nous Complex</h1><h2>Attendance Report</h2><p>Generated on: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p></div>
        <div class="report-meta">
          <span class="meta-item"><strong>Date Range:</strong> ${from || 'N/A'} to ${to || 'N/A'}</span>
          <span class="meta-item"><strong>Class:</strong> ${esc(className)}</span>
          <span class="meta-item"><strong>Student:</strong> ${esc(studentName)}</span>
          <span class="meta-item"><strong>Total Students:</strong> ${results.length}</span>
          <span class="meta-item"><strong>Report Type:</strong> ${document.getElementById('report-view')?.selectedOptions?.[0]?.textContent || 'Summary By Student Only'}</span>
        </div>
        <div class="stats-grid">
          <div class="stat-box highlight"><span class="number">${results.length}</span><span class="label">Total Students</span></div>
          <div class="stat-box"><span class="number">${state.reportTotalDays || results[0]?.totalDays || 0}</span><span class="label">Total Days</span></div>
          <div class="stat-box"><span class="number">${state.reportTotalHolidays || 0}</span><span class="label">Holidays</span></div>
          <div class="stat-box highlight"><span class="number">${state.reportTotalDesignatedDays || totalDesignatedDays}</span><span class="label">Designated Days</span></div>
          <div class="stat-box green"><span class="number">${totalPresent}</span><span class="label">Present</span></div>
          <div class="stat-box red"><span class="number">${totalAbsent}</span><span class="label">Absent</span></div>
          <div class="stat-box yellow"><span class="number">${totalLeave}</span><span class="label">Leave</span></div>
          <div class="stat-box highlight"><span class="number">${overallAttendance}%</span><span class="label">Overall Attendance</span></div>
        </div>
        ${includeSummary ? `
        <h3 class="section-title">Student Summary</h3>
        <table><thead><tr><th>Roll</th><th>Student</th><th>Class</th><th>Total Days</th><th>Holidays</th><th>Designated Days</th><th>Present</th><th>Absent</th><th>Leave</th><th>Attendance %</th></tr></thead><tbody>
          ${results.map(s => `<tr>
            <td>${esc(s.roll)}</td>
            <td>${esc(s.name)}</td>
            <td>${esc(s.class)}</td>
            <td>${s.totalDays}</td>
            <td>${s.holidayCount}</td>
            <td>${s.designatedDays}</td>
            <td>${s.presentCount}</td>
            <td>${s.absentCount}</td>
            <td>${s.leaveCount}</td>
            <td><span class="${s.attendancePercentage >= 75 ? 'pct-high' : 'pct-low'}">${s.attendancePercentage}%</span></td>
          </tr>`).join("")}
        </tbody></table>
        ` : ''}
        ${includeDetail && detailRows.length > 0 ? `
          <h3 class="section-title">Detailed Records</h3>
          <table><thead><tr><th>Roll</th><th>Student</th><th>Date</th><th>Class</th><th>Status</th><th>Remarks</th></tr></thead><tbody>
            ${detailRows.map(r => `<tr>
              <td>${esc(r.roll)}</td>
              <td>${esc(r.student)}</td>
              <td>${esc(r.date)}</td>
              <td>${esc(r.class)}</td>
              <td><span class="badge ${r.status}">${esc(r.status || '—')}</span></td>
              <td>${esc(r.remarks || "—")}</td>
            </tr>`).join("")}
          </tbody></table>
        ` : ''}
        ${includeDetail && !includeSummary && detailRows.length === 0 ? `<p style="text-align:center;color:#9ca3af;padding:20px;">No detailed records found for the selected filters.</p>` : ''}
        <div class="footer"><p>Report generated from <strong>Nous Complex Attendance Portal</strong></p><p>© ${new Date().getFullYear()} Nous Complex • All Rights Reserved</p></div>
      </body></html>
    `;
    
    const win = window.open('', '_blank', 'width=1000,height=800,scrollbars=yes');
    if (win) { win.document.write(html); win.document.close(); setTimeout(() => { win.print(); }, 800); } 
    else { flash("Please allow popups to export PDF.", true); }
  }

  // --- Calendar View ---
  let calendarDate = new Date();
  let selectedDates = new Set();

  async function calendar() {
    if (!isAdmin()) return navigate("dashboard");
    setTemplate("#calendar-template");
    
    await getClasses();
    const filter = document.getElementById('calendar-class-filter');
    filter.innerHTML = `<option value="">All Classes</option>` + 
      state.classes.map(c => `<option value="${c.id}">${esc(c.name)}${c.section ? " — " + esc(c.section) : ""}</option>`).join("");
    
    document.getElementById('calendar-prev').onclick = () => { calendarDate.setMonth(calendarDate.getMonth() - 1); selectedDates.clear(); renderCalendar(); };
    document.getElementById('calendar-next').onclick = () => { calendarDate.setMonth(calendarDate.getMonth() + 1); selectedDates.clear(); renderCalendar(); };
    document.getElementById('calendar-today').onclick = () => { calendarDate = new Date(); selectedDates.clear(); renderCalendar(); };
    
    document.getElementById('mark-holiday').onclick = () => markSelectedDates('holiday');
    document.getElementById('mark-designated').onclick = () => markSelectedDates('designated');
    document.getElementById('clear-selected').onclick = clearAllSelectedDates;
    document.getElementById('clear-selection').onclick = clearSelection;
    document.getElementById('calendar-detail-close').onclick = () => {
      document.getElementById('calendar-details').style.display = 'none';
    };
    
    filter.onchange = () => { selectedDates.clear(); renderCalendar(); };
    
    await renderCalendar();
    applyRoleVisibility();
  }

  async function renderCalendar() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('calendar-month-year').textContent = `${monthNames[month]} ${year}`;
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const todayStr = toLocalISODate(today);
    
    await getClasses();
    const classId = document.getElementById('calendar-class-filter')?.value || '';
    
    const monthStart = toLocalISODate(new Date(year, month, 1));
    const monthEnd = toLocalISODate(new Date(year, month + 1, 0));
    
    let holidayQuery = state.db.from("holidays").select("date,class_id,reason").gte("date", monthStart).lte("date", monthEnd);
    if (classId) holidayQuery = holidayQuery.eq("class_id", classId);
    const holidays = await api(holidayQuery);
    const holidayMap = {};
    holidays.forEach(h => { if (!holidayMap[h.date]) holidayMap[h.date] = []; holidayMap[h.date].push(h); });
    
    let designatedQuery = state.db.from("designated_days").select("date,class_id,reason").gte("date", monthStart).lte("date", monthEnd);
    if (classId) designatedQuery = designatedQuery.eq("class_id", classId);
    const designatedDays = await api(designatedQuery);
    const designatedMap = {};
    designatedDays.forEach(d => { if (!designatedMap[d.date]) designatedMap[d.date] = []; designatedMap[d.date].push(d); });
    
    const grid = document.getElementById('calendar-grid');
    let html = `<table><thead><tr><th>Sun</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th></tr></thead><tbody>`;
    
    let day = 1;
    let col = firstDay;
    html += `<tr>`;
    for (let i = 0; i < firstDay; i++) html += `<td class="calendar-empty"></td>`;
    
    while (day <= daysInMonth) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;
      const isWeekendDay = isWeekend(dateStr);
      const isHolidayDay = holidayMap[dateStr] && holidayMap[dateStr].length > 0;
      const isDesignatedDay = designatedMap[dateStr] && designatedMap[dateStr].length > 0;
      const isSelected = selectedDates.has(dateStr);
      
      let cellClass = 'calendar-day';
      if (isToday) cellClass += ' today';
      if (isSelected) cellClass += ' selected';
      
      // Priority: Holiday > Designated > Weekend > Normal
      if (isHolidayDay) {
        cellClass += ' weekend'; // Holiday shows as yellow
      } else if (isDesignatedDay) {
        cellClass += ' designated'; // Designated shows as blue
      } else if (isWeekendDay) {
        cellClass += ' weekend'; // Weekend shows as yellow
      }
      
      let tooltip = `${day} ${monthNames[month]} ${year}`;
      let detailData = [];
      if (isHolidayDay) {
        const reasons = holidayMap[dateStr].map(h => h.reason || 'Holiday').join(', ');
        tooltip += `\nHoliday: ${reasons}`;
        detailData.push({ type: 'Holiday', reason: reasons, items: holidayMap[dateStr] });
      } else if (isDesignatedDay) {
        const reasons = designatedMap[dateStr].map(d => d.reason || 'Designated Day').join(', ');
        tooltip += `\nDesignated: ${reasons}`;
        detailData.push({ type: 'Designated Day', reason: reasons, items: designatedMap[dateStr] });
      } else if (isWeekendDay) {
        tooltip += `\nWeekend (Saturday/Sunday)`;
        detailData.push({ type: 'Weekend', reason: 'Weekend' });
      }
      if (isSelected) tooltip += `\n✓ Selected`;
      
      html += `<td class="${cellClass}" data-date="${dateStr}" data-detail='${JSON.stringify(detailData).replace(/'/g, "&#39;")}' title="${esc(tooltip)}">
        <span class="day-number">${day}</span>
      </td>`;
      
      day++; col++;
      if (col > 6) { col = 0; html += `</tr><tr>`; }
    }
    
    while (col <= 6) { html += `<td class="calendar-empty"></td>`; col++; }
    html += `</tr></tbody></table>`;
    grid.innerHTML = html;
    
    document.querySelectorAll('.calendar-day').forEach(cell => {
      cell.addEventListener('click', function(e) {
        const date = this.dataset.date;
        if (selectedDates.has(date)) {
          selectedDates.delete(date);
        } else {
          selectedDates.add(date);
        }
        renderCalendar();
        updateSelectionInfo();
        if (selectedDates.size === 1) {
          const detailData = JSON.parse(this.dataset.detail || '[]');
          showDateDetails(date, detailData);
        } else if (selectedDates.size === 0) {
          document.getElementById('calendar-details').style.display = 'none';
        } else {
          showMultipleSelectionDetails();
        }
      });
    });
    
    updateSelectionInfo();
  }

  function updateSelectionInfo() {
    const countEl = document.getElementById('selection-count');
    const infoEl = document.getElementById('selected-info');
    const listEl = document.getElementById('selected-days-list');
    
    if (selectedDates.size > 0) {
      countEl.style.display = 'inline';
      countEl.textContent = `${selectedDates.size} day${selectedDates.size > 1 ? 's' : ''} selected`;
      infoEl.style.display = 'block';
      const sorted = Array.from(selectedDates).sort();
      listEl.textContent = sorted.join(', ');
    } else {
      countEl.style.display = 'none';
      infoEl.style.display = 'none';
    }
  }

  function showMultipleSelectionDetails() {
    const detailContainer = document.getElementById('calendar-details');
    const detailDate = document.getElementById('calendar-detail-date');
    const detailContent = document.getElementById('calendar-detail-content');
    
    detailContainer.style.display = 'block';
    detailDate.textContent = `📅 ${selectedDates.size} days selected`;
    
    let html = `<p style="color:#6b7280; font-size:13px; margin-bottom:10px;">Selected dates: ${Array.from(selectedDates).sort().join(', ')}</p>`;
    html += `<p style="font-size:13px; color:#4f46e5;">Use the buttons above to mark all selected days as Holiday or Designated Day.</p>`;
    detailContent.innerHTML = html;
  }

  function showDateDetails(date, details) {
    const detailContainer = document.getElementById('calendar-details');
    const detailDate = document.getElementById('calendar-detail-date');
    const detailContent = document.getElementById('calendar-detail-content');
    
    detailContainer.style.display = 'block';
    detailDate.textContent = `📅 ${date}`;
    
    if (details && details.length > 0) {
      let html = '';
      details.forEach(d => {
        const borderColor = d.type === 'Holiday' ? '#f59e0b' : d.type === 'Designated Day' ? '#3b82f6' : '#6b7280';
        html += `<div style="margin:5px 0; padding:8px 12px; background:white; border-radius:6px; border-left:4px solid ${borderColor};">
          <strong>${d.type}</strong>
          <span style="color:#6b7280; margin-left:10px;">${esc(d.reason || '')}</span>
        </div>`;
      });
      detailContent.innerHTML = html;
    } else {
      detailContent.innerHTML = '<p class="muted" style="margin:0;">No events on this date.</p>';
    }
  }

  async function markSelectedDates(type) {
    if (selectedDates.size === 0) {
      flash("Please select at least one date first. Click on dates to select them.", true);
      return;
    }
    
    const classId = document.getElementById('calendar-class-filter')?.value || null;
    const label = type === 'holiday' ? 'Holiday' : 'Designated Day';
    
    const reason = prompt(`Enter reason for ${label} for ${selectedDates.size} selected day(s):`, label);
    if (reason === null) return;
    
    let successCount = 0;
    let skipCount = 0;
    let removedCount = 0;
    
    for (const date of selectedDates) {
      if (type === 'holiday') {
        // Mark as holiday - remove any existing designated day for this date
        let designatedQuery = state.db.from("designated_days").select("id").eq("date", date);
        if (classId) designatedQuery = designatedQuery.eq("class_id", classId);
        else designatedQuery = designatedQuery.is("class_id", null);
        const existingDesignated = await api(designatedQuery.maybeSingle());
        if (existingDesignated) {
          await api(state.db.from("designated_days").delete().eq("id", existingDesignated.id));
          removedCount++;
        }
        
        // Check if holiday already exists
        let holidayQuery = state.db.from("holidays").select("id").eq("date", date);
        if (classId) holidayQuery = holidayQuery.eq("class_id", classId);
        else holidayQuery = holidayQuery.is("class_id", null);
        const existingHoliday = await api(holidayQuery.maybeSingle());
        
        if (existingHoliday) {
          skipCount++;
          continue;
        }
        
        try {
          await api(state.db.from("holidays").insert({ class_id: classId, date: date, reason: reason }));
          successCount++;
        } catch (err) {
          flash(err.message, true);
        }
      } else {
        // Mark as designated - remove any existing holiday for this date
        let holidayQuery = state.db.from("holidays").select("id").eq("date", date);
        if (classId) holidayQuery = holidayQuery.eq("class_id", classId);
        else holidayQuery = holidayQuery.is("class_id", null);
        const existingHoliday = await api(holidayQuery.maybeSingle());
        if (existingHoliday) {
          await api(state.db.from("holidays").delete().eq("id", existingHoliday.id));
          removedCount++;
        }
        
        // Check if designated already exists
        let designatedQuery = state.db.from("designated_days").select("id").eq("date", date);
        if (classId) designatedQuery = designatedQuery.eq("class_id", classId);
        else designatedQuery = designatedQuery.is("class_id", null);
        const existingDesignated = await api(designatedQuery.maybeSingle());
        
        if (existingDesignated) {
          skipCount++;
          continue;
        }
        
        try {
          await api(state.db.from("designated_days").insert({ class_id: classId, date: date, reason: reason }));
          successCount++;
        } catch (err) {
          flash(err.message, true);
        }
      }
    }
    
    let message = `✅ ${successCount} day(s) marked as ${label}.`;
    if (skipCount > 0) message += ` ⚠️ ${skipCount} already existed.`;
    if (removedCount > 0) {
      message += ` 🔄 ${removedCount} conflicting designation(s) removed.`;
    }
    flash(message, false);
    
    selectedDates.clear();
    renderCalendar();
  }

  async function clearAllSelectedDates() {
    if (selectedDates.size === 0) {
      flash("Please select at least one date first.", true);
      return;
    }
    
    const classId = document.getElementById('calendar-class-filter')?.value || null;
    
    if (!confirm(`Remove all events from ${selectedDates.size} selected day(s)?`)) return;
    
    let successCount = 0;
    
    for (const date of selectedDates) {
      let holidayQuery = state.db.from("holidays").select("id").eq("date", date);
      let designatedQuery = state.db.from("designated_days").select("id").eq("date", date);
      
      if (classId) {
        holidayQuery = holidayQuery.eq("class_id", classId);
        designatedQuery = designatedQuery.eq("class_id", classId);
      } else {
        holidayQuery = holidayQuery.is("class_id", null);
        designatedQuery = designatedQuery.is("class_id", null);
      }
      
      const holiday = await api(holidayQuery.maybeSingle());
      const designated = await api(designatedQuery.maybeSingle());
      
      try {
        if (holiday) await api(state.db.from("holidays").delete().eq("id", holiday.id));
        if (designated) await api(state.db.from("designated_days").delete().eq("id", designated.id));
        if (holiday || designated) successCount++;
      } catch (err) {
        flash(err.message, true);
      }
    }
    
    flash(`✅ Cleared events from ${successCount} day(s).`);
    selectedDates.clear();
    renderCalendar();
  }

  function clearSelection() {
    selectedDates.clear();
    renderCalendar();
    document.getElementById('calendar-details').style.display = 'none';
    flash("Selection cleared.");
  }

  // --- Admin Tools ---
  async function adminTools() {
    if (!isAdmin()) return navigate("dashboard");
    setTemplate("#admin-tools-template");
    await getClasses();

    // --- Teacher Attendance Permissions Panel ---
    // Check if panel already exists, if not create it
    let permissionsSection = document.querySelector('#permissions-panel');
    if (!permissionsSection) {
      permissionsSection = document.createElement('div');
      permissionsSection.id = 'permissions-panel';
      permissionsSection.className = 'admin-panel';
      permissionsSection.innerHTML = `
        <h3>Teacher Attendance Permissions</h3>
        <p class="muted">Control which teachers can mark attendance and their date restrictions.</p>
        <div style="margin-top:15px;">
          <label style="display:block;font-weight:600;margin-bottom:8px;color:#374151;">Select Teacher:</label>
          <select id="permission-teacher" style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;margin-bottom:15px;background:#f9fafb;">
            <option value="">Select a teacher...</option>
          </select>
        </div>
        <div id="permission-controls" style="display:none;">
          <div class="permission-grid">
            <div class="permission-item master">
              <label>
                <input type="checkbox" id="permission-can-mark" checked>
                <span>
                  <span class="label-text">Allow Marking Attendance</span>
                  <span class="label-sub">Master switch — disables all options below if turned off</span>
                </span>
              </label>
            </div>
            <div class="permission-item sub" data-sub-permission>
              <label>
                <input type="checkbox" id="permission-past-dates" checked>
                <span>
                  <span class="label-text">Allow Marking <strong>Past</strong> Dates</span>
                  <span class="label-sub">Permit attendance entry for dates before today</span>
                </span>
              </label>
            </div>
            <div class="permission-item sub" data-sub-permission>
              <label>
                <input type="checkbox" id="permission-future-dates">
                <span>
                  <span class="label-text">Allow Marking <strong>Future</strong> Dates</span>
                  <span class="label-sub">Permit attendance entry for dates after today</span>
                </span>
              </label>
            </div>
            <div class="permission-item sub" data-sub-permission>
              <label>
                <input type="checkbox" id="permission-holidays">
                <span>
                  <span class="label-text">Allow Marking on <strong>Holidays / Weekends</strong></span>
                  <span class="label-sub">Permit attendance entry on non-school days</span>
                </span>
              </label>
            </div>
          </div>
          <div style="display:flex;gap:12px;margin-top:15px;flex-wrap:wrap;">
            <button id="save-permissions" class="primary" style="padding:10px 28px;font-weight:600;flex:0 0 auto;">💾 Save Permissions</button>
            <button id="reset-permissions" class="secondary" style="padding:10px 28px;font-weight:600;flex:0 0 auto;">↺ Reset to Default</button>
          </div>
          <div id="permission-result" style="margin-top:10px;font-size:14px;"></div>
        </div>
      `;
      
      // Insert at the top of the panel section
      const panel = document.querySelector('.panel');
      if (panel) {
        panel.insertBefore(permissionsSection, panel.firstChild);
      }
    }
    
    // Populate teacher dropdown
    const teachers = await api(state.db.from("teachers").select("id,name,profile_id").order("name"));
    const teacherSelect = document.getElementById('permission-teacher');
    // Clear existing options except the first one
    while (teacherSelect.options.length > 1) {
      teacherSelect.remove(1);
    }
    teachers.forEach(t => {
      const option = document.createElement('option');
      option.value = t.id;
      option.textContent = t.name;
      teacherSelect.appendChild(option);
    });
    
    // Keep the sequence visually and functionally consistent: options 2-4
    // only make sense once "Allow marking attendance" (option 1) is on.
    function applyPermissionSequenceState() {
      const masterOn = document.getElementById('permission-can-mark').checked;
      $$('[data-sub-permission]').forEach(row => {
        const checkbox = row.querySelector('input[type="checkbox"]');
        checkbox.disabled = !masterOn;
        row.style.opacity = masterOn ? '1' : '0.5';
        row.style.pointerEvents = masterOn ? 'auto' : 'none';
      });
    }
    document.getElementById('permission-can-mark').onchange = applyPermissionSequenceState;

    // Load permissions when teacher is selected
    teacherSelect.onchange = async function() {
      const teacherId = this.value;
      const controls = document.getElementById('permission-controls');
      if (!teacherId) {
        controls.style.display = 'none';
        return;
      }
      controls.style.display = 'block';
      
      const perm = await api(state.db.from("teacher_attendance_permissions")
        .select("*")
        .eq("teacher_id", teacherId)
        .maybeSingle());
      
      if (perm) {
        document.getElementById('permission-can-mark').checked = perm.can_mark_attendance !== false;
        document.getElementById('permission-past-dates').checked = perm.allow_past_dates !== false;
        document.getElementById('permission-future-dates').checked = perm.allow_future_dates === true;
        document.getElementById('permission-holidays').checked = perm.allow_holidays === true;
      } else {
        document.getElementById('permission-can-mark').checked = true;
        document.getElementById('permission-past-dates').checked = true;
        document.getElementById('permission-future-dates').checked = false;
        document.getElementById('permission-holidays').checked = false;
      }
      applyPermissionSequenceState();
    };
    
    document.getElementById('save-permissions').onclick = async function() {
      const teacherId = document.getElementById('permission-teacher').value;
      if (!teacherId) {
        document.getElementById('permission-result').innerHTML = '<div style="color:#ef4444;">Please select a teacher first.</div>';
        return;
      }
      
      const permissions = {
        teacher_id: teacherId,
        can_mark_attendance: document.getElementById('permission-can-mark').checked,
        allow_past_dates: document.getElementById('permission-past-dates').checked,
        allow_future_dates: document.getElementById('permission-future-dates').checked,
        allow_holidays: document.getElementById('permission-holidays').checked
      };
      
      try {
        const existing = await api(state.db.from("teacher_attendance_permissions")
          .select("id")
          .eq("teacher_id", teacherId)
          .maybeSingle());
        
        if (existing) {
          await api(state.db.from("teacher_attendance_permissions")
            .update(permissions)
            .eq("id", existing.id));
        } else {
          const { data, error } = await state.db
            .from("teacher_attendance_permissions")
            .insert(permissions)
            .select();
          
          if (error) {
            const { error: upsertError } = await state.db
              .from("teacher_attendance_permissions")
              .upsert(permissions, { onConflict: 'teacher_id' });
            
            if (upsertError) throw upsertError;
          }
        }
        
        document.getElementById('permission-result').innerHTML = '<div style="color:#166534;padding:8px;background:rgba(22,101,52,0.1);border-radius:6px;">✅ Permissions saved successfully.</div>';
        setTimeout(() => { document.getElementById('permission-result').innerHTML = ''; }, 3000);
        
        if (state.teacher && state.teacher.id === teacherId) {
          await loadTeacherPermissions();
        }
      } catch (err) {
        console.error('Permission save error:', err);
        document.getElementById('permission-result').innerHTML = `<div style="color:#ef4444;padding:8px;background:rgba(239,68,68,0.1);border-radius:6px;">❌ Error: ${err.message}</div>`;
      }
    };
    
    document.getElementById('reset-permissions').onclick = async function() {
      const teacherId = document.getElementById('permission-teacher').value;
      if (!teacherId) {
        document.getElementById('permission-result').innerHTML = '<div style="color:#ef4444;">Please select a teacher first.</div>';
        return;
      }
      
      if (!confirm('Reset all permissions for this teacher to default?')) return;
      
      try {
        const existing = await api(state.db.from("teacher_attendance_permissions")
          .select("id")
          .eq("teacher_id", teacherId)
          .maybeSingle());
        
        if (existing) {
          await api(state.db.from("teacher_attendance_permissions")
            .delete()
            .eq("id", existing.id));
        }
        
        document.getElementById('permission-can-mark').checked = true;
        document.getElementById('permission-past-dates').checked = true;
        document.getElementById('permission-future-dates').checked = false;
        document.getElementById('permission-holidays').checked = false;
        applyPermissionSequenceState();
        
        document.getElementById('permission-result').innerHTML = '<div style="color:#166534;padding:8px;background:rgba(22,101,52,0.1);border-radius:6px;">✅ Permissions reset to default.</div>';
        setTimeout(() => { document.getElementById('permission-result').innerHTML = ''; }, 3000);
      } catch (err) {
        document.getElementById('permission-result').innerHTML = `<div style="color:#ef4444;padding:8px;background:rgba(239,68,68,0.1);border-radius:6px;">❌ Error: ${err.message}</div>`;
      }
    };
    
    // --- Clear Attendance Data ---
    const classOptionsHtml = `<option value="">All Classes</option>` + 
      state.classes.map(c => `<option value="${c.id}">${esc(c.name)}${c.section ? " — " + esc(c.section) : ""}</option>`).join("");
    
    document.getElementById('clear-class').innerHTML = classOptionsHtml;
    
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
    document.getElementById('clear-from').value = toLocalISODate(monthAgo);
    document.getElementById('clear-to').value = isoToday();
    document.getElementById('clear-attendance').onclick = clearAttendanceData;
    applyRoleVisibility();
    
    setTimeout(restoreDropdownSelections, 200);
  }

  // --- Clear Attendance Data ---
  async function clearAttendanceData() {
    if (!isAdmin()) { flash("Only admins can clear attendance data.", true); return; }
    const from = document.getElementById('clear-from').value;
    const to = document.getElementById('clear-to').value;
    const classId = document.getElementById('clear-class').value;
    const studentId = document.getElementById('clear-student').value;
    if (!from || !to) { flash("Please select both from and to dates.", true); return; }
    if (from > to) { flash("From date must be before to date.", true); return; }
    let confirmMsg = `Are you sure you want to delete all attendance records from ${from} to ${to}?`;
    if (classId) { const cls = state.classes.find(c => c.id === classId); confirmMsg += `\nClass: ${cls ? cls.name + (cls.section ? " — " + cls.section : "") : "Selected"}`; }
    if (studentId) { const student = await api(state.db.from("students").select("name,roll_number").eq("id", studentId).single()); confirmMsg += `\nStudent: ${student ? student.roll_number + " — " + student.name : "Selected"}`; }
    confirmMsg += "\n\nThis action CANNOT be undone!";
    if (!confirm(confirmMsg)) return;
    try {
      let query = state.db.from("attendance_sessions").select("id").gte("attendance_date", from).lte("attendance_date", to);
      if (classId) query = query.eq("class_id", classId);
      const sessions = await api(query);
      const sessionIds = sessions.map(s => s.id);
      if (sessionIds.length === 0) { flash("No attendance records found in this date range.", true); return; }
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

  // --- Sidebar Toggle ---
  function openSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) {
      sidebar.classList.add('open');
      const menuToggle = document.getElementById('menu-toggle-btn');
      if (menuToggle) {
        menuToggle.classList.add('is-hidden');
        menuToggle.style.setProperty('display', 'none', 'important');
      }
    }
    if (overlay) overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) {
      sidebar.classList.remove('open');
      const menuToggle = document.getElementById('menu-toggle-btn');
      if (menuToggle && window.innerWidth <= 768) {
        menuToggle.classList.remove('is-hidden');
        menuToggle.style.removeProperty('display');
      }
    }
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
  }

  // --- Reset Password Handler for Email Link ---
  function openResetModal() {
    hideLoadingScreen();
    setTimeout(() => {
      $("#reset-password").value = "";
      $("#reset-password-confirm").value = "";
      $("#reset-message").textContent = "";
      $("#reset-modal").classList.add("show");
    }, 300);
  }

  function cleanResetUrl() {
    const path = window.location.pathname.includes('/nousomplex-attendance/')
      ? '/nousomplex-attendance/'
      : window.location.pathname;
    window.history.replaceState({}, '', path);
  }

  function handlePasswordReset() {
    if (!state.db) return;

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const queryParams = new URLSearchParams(window.location.search);

    const type = hashParams.get('type') || queryParams.get('type');
    const accessToken = hashParams.get('access_token') || queryParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token') || queryParams.get('refresh_token');
    const code = queryParams.get('code');

    if (type === 'recovery' && accessToken) {
      state.recoveryMode = true;
      showLoadingScreen('Verifying reset link...');
      state.db.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      }).then(({ error }) => {
        if (error) throw error;
        cleanResetUrl();
        openResetModal();
      }).catch((err) => {
        console.error('Reset link error:', err);
        state.recoveryMode = false;
        hideLoadingScreen();
        cleanResetUrl();
        flash("Invalid or expired reset link. Please request a new one.", true);
      });
      return;
    }

    if (code) {
      state.recoveryMode = true;
      showLoadingScreen('Verifying reset link...');
      state.db.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) throw error;
        cleanResetUrl();
        openResetModal();
      }).catch((err) => {
        console.error('Reset link error:', err);
        state.recoveryMode = false;
        hideLoadingScreen();
        cleanResetUrl();
        flash("Invalid or expired reset link. Please request a new one.", true);
      });
    }
  }

  // --- Global event listeners for dropdown persistence ---
  document.addEventListener('change', function(e) {
    if (e.target.tagName === 'SELECT' && e.target.id) {
      saveDropdownSelections();
    }
  });

  // --- Init ---
  function init() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.style.display = 'flex';
    }
    
    if (configured) {
      state.db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    }
    
    $("#auth-form").onsubmit = signIn; 
    $("#signup-button").onclick = signUp;
    $("#forgot-password-btn").onclick = forgotPassword;
    $("#signout").onclick = async () => { 
      await state.db.auth.signOut(); 
      cachedClasses = null; 
      localStorage.removeItem('nousomplex_last_page');
      localStorage.removeItem('nousomplex_attendance_date');
      localStorage.removeItem('nousomplex_attendance_class');
      showAuth(); 
    };
    
    $("#reset-submit").onclick = resetPassword;
    $("#reset-cancel").onclick = async () => {
      $("#reset-modal").classList.remove("show");
      $("#reset-password").value = "";
      $("#reset-password-confirm").value = "";
      $("#reset-message").textContent = "";
      if (state.recoveryMode) {
        state.recoveryMode = false;
        try { await state.db.auth.signOut(); } catch (e) { /* ignore */ }
        showAuth();
      }
    };
    
    if (state.db) {
      state.db.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY") {
          state.recoveryMode = true;
          cleanResetUrl();
          openResetModal();
        }
      });
    }

    handlePasswordReset();
    
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
    if (overlay) overlay.addEventListener('click', closeSidebar);
    if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeSidebar(); });
    window.addEventListener('resize', function() {
      const appEl = document.getElementById('app');
      const loggedIn = appEl && !appEl.classList.contains('hidden');
      if (!loggedIn) return;

      if (window.innerWidth > 768 && sidebar) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        document.body.style.overflow = '';
      }
      if (window.innerWidth <= 768) {
        const menuToggleBtn = document.getElementById('menu-toggle-btn');
        if (menuToggleBtn && sidebar) {
          const isOpen = sidebar.classList.contains('open');
          menuToggleBtn.classList.toggle('is-hidden', isOpen);
          if (isOpen) menuToggleBtn.style.setProperty('display', 'none', 'important');
          else menuToggleBtn.style.removeProperty('display');
        }
      }
    });
    document.addEventListener('click', function(e) {
      const navButton = e.target.closest('#nav button[data-page]');
      if (navButton && window.innerWidth <= 768) setTimeout(closeSidebar, 300);
    });

    document.addEventListener('click', function(e) {
      const button = e.target.closest('#nav button[data-page]');
      if (button) { e.preventDefault(); const page = button.dataset.page; if (page) navigate(page); }
    });
    document.addEventListener('click', function(e) {
      const goButton = e.target.closest('[data-go]');
      if (goButton) { const page = goButton.dataset.go; if (page) navigate(page); }
    });
    
    setTimeout(restoreDropdownSelections, 500);
    
    if (configured) {
      setTimeout(() => {
        loadSession();
      }, 100);
    } else {
      hideLoadingScreen();
      ensureConfigured();
    }
  }
  
  init();
})();
