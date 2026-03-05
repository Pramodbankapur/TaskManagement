import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

type Role = "OWNER" | "MANAGER" | "EMPLOYEE";
type TaskStatus = "OPEN" | "IN_PROGRESS" | "CLOSED";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type Focus = "none" | "complaints_today" | "pending" | "closed" | "overdue";
type SortBy = "created_desc" | "created_asc" | "deadline_asc" | "deadline_desc" | "priority_desc" | "priority_asc";

type User = { id: number; name: string; email: string; role: Role };
type Notification = { id: number; message: string; read: boolean; created_at: string };
type Toast = { id: number; message: string };
type LocalComplaintRecord = {
  localId: number;
  serverComplaintId?: number;
  organization_name: string;
  contact_name: string;
  client_email: string;
  client_phone: string;
  description: string;
  priority: Priority;
  status: TaskStatus;
  created_at: string;
};

type TaskItem = {
  id: number;
  status: TaskStatus;
  deadline: string;
  created_at: string;
  complaint_id: number;
  complaint_description: string;
  organization_name: string;
  contact_name: string;
  priority: Priority;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
const GOOGLE_FORM_URL = import.meta.env.VITE_GOOGLE_FORM_URL || "";
const ENABLE_LOCAL_COMPLAINT_STORAGE = true;
const LOCAL_COMPLAINTS_KEY = "complaints_local_v1";
const LOCAL_COMPLAINTS_COUNTER_KEY = "complaints_local_counter_v1";

function readLocalComplaints(): LocalComplaintRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_COMPLAINTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalComplaintRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writeLocalComplaints(items: LocalComplaintRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_COMPLAINTS_KEY, JSON.stringify(items));
}

function nextLocalComplaintId(): number {
  if (typeof window === "undefined") return Date.now();
  const current = Number(window.localStorage.getItem(LOCAL_COMPLAINTS_COUNTER_KEY) || "900000");
  const next = current + 1;
  window.localStorage.setItem(LOCAL_COMPLAINTS_COUNTER_KEY, String(next));
  return next;
}

function saveLocalComplaint(input: {
  organizationName: string;
  contactName: string;
  email: string;
  phone: string;
  description: string;
  serverComplaintId?: number;
}): LocalComplaintRecord {
  const complaints = readLocalComplaints();
  const item: LocalComplaintRecord = {
    localId: nextLocalComplaintId(),
    serverComplaintId: input.serverComplaintId,
    organization_name: input.organizationName,
    contact_name: input.contactName,
    client_email: input.email,
    client_phone: input.phone,
    description: input.description,
    priority: "MEDIUM",
    status: "OPEN",
    created_at: new Date().toISOString()
  };
  complaints.unshift(item);
  writeLocalComplaints(complaints);
  return item;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options?.headers || {})
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Request failed");
  }

  return response.json();
}

function priorityClass(priority: string): string {
  if (priority === "CRITICAL") return "badge critical";
  if (priority === "HIGH") return "badge high";
  if (priority === "MEDIUM") return "badge medium";
  return "badge low";
}

function priorityRank(priority: Priority): number {
  if (priority === "CRITICAL") return 4;
  if (priority === "HIGH") return 3;
  if (priority === "MEDIUM") return 2;
  return 1;
}

function complaintKey(id: number): string {
  return `CMP-${String(id).padStart(6, "0")}`;
}

function currentLocalDateTimeInput(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function Shell({ children, user }: { children: React.ReactNode; user?: User | null }) {
  const location = useLocation();
  const isClientPortal = location.pathname.startsWith("/client");
  const isInternalPortal = location.pathname.startsWith("/internal");

  return (
    <div className="shell">
      <header>
        <div>
          <h1>Task & Complaint Management</h1>
          <p className="small">Public client portal and internal operations panel</p>
        </div>
        <nav>
          {isClientPortal && <Link to="/client/complaint">Client Portal</Link>}
          {isInternalPortal && (user ? <Link to="/internal/dashboard">Internal Dashboard</Link> : <Link to="/internal/login">Internal Login</Link>)}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}

function MetricCard({ title, value, onClick, active }: { title: string; value: string | number; onClick?: () => void; active?: boolean }) {
  return (
    <button className={`metric-card ${active ? "active" : ""}`} onClick={onClick}>
      <span>{title}</span>
      <strong>{value}</strong>
    </button>
  );
}

function BarChart({ title, data }: { title: string; data: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="bars">
        {data.map((d) => (
          <div key={d.label} className="bar-row">
            <span>{d.label}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${Math.round((d.value / max) * 100)}%` }} />
            </div>
            <strong>{d.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClientComplaintPage() {
  const [message, setMessage] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");
    const form = new FormData(e.currentTarget);

    const payload = {
      organizationName: String(form.get("organizationName") || ""),
      contactName: String(form.get("contactName") || ""),
      email: String(form.get("email") || ""),
      phone: String(form.get("phone") || ""),
      description: String(form.get("description") || "")
    };

    setLoading(true);
    try {
      const response = await api<{ success: boolean; complaintId?: number }>("/api/public/complaints", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      if (ENABLE_LOCAL_COMPLAINT_STORAGE) {
        saveLocalComplaint({ ...payload, serverComplaintId: response.complaintId });
      }
      setMessage("Complaint submitted successfully.");
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      if (ENABLE_LOCAL_COMPLAINT_STORAGE) {
        saveLocalComplaint(payload);
        setMessage("Backend unavailable. Complaint saved locally for testing.");
      } else {
        setMessage((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2>Client Complaint Form</h2>
      <form onSubmit={onSubmit} className="grid">
        <input name="organizationName" placeholder="Company / Organization Name" required />
        <input name="contactName" placeholder="Your Name" required />
        <input name="email" type="email" placeholder="Email" required />
        <input name="phone" placeholder="Phone" required />
        <textarea name="description" placeholder="Complaint / Task description" required minLength={10} />
        <button disabled={loading}>{loading ? "Submitting..." : "Submit Complaint"}</button>
      </form>
      {GOOGLE_FORM_URL && (
        <p className="small">
          Google Form option: <a href={GOOGLE_FORM_URL}>Open external form</a>
        </p>
      )}
      {message && <p className="msg">{message}</p>}
    </div>
  );
}

function InternalLoginPage({ onLogin }: { onLogin: (u: User) => void }) {
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);

    try {
      const user = await api<User>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
      });
      onLogin(user);
      navigate("/internal/dashboard");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="card">
      <h2>Internal Login</h2>
      <form onSubmit={submit} className="grid">
        <input name="email" type="email" placeholder="Work Email" required />
        <div className="password-row">
          <input name="password" type={showPassword ? "text" : "password"} placeholder="Password" required />
          <button type="button" onClick={() => setShowPassword((prev) => !prev)}>
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <button type="submit">Sign In</button>
      </form>
      <p className="small">Internal access only. Contact owner for account creation.</p>
      {error && <p className="msg error">{error}</p>}
    </div>
  );
}

function NotificationPanel({ notifications, refresh }: { notifications: Notification[]; refresh: () => Promise<void> }) {
  async function markRead(id: number) {
    await api(`/api/notifications/${id}/read`, { method: "PATCH" });
    await refresh();
  }

  return (
    <div className="card">
      <h3>Notifications</h3>
      {notifications.length === 0 && <p className="small">No unread notifications.</p>}
      {notifications.map((n) => (
        <div key={n.id} className="notification-row">
          <span>{n.message}</span>
          <button onClick={() => markRead(n.id)}>Mark read</button>
        </div>
      ))}
    </div>
  );
}

function InternalDashboardPage({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [summary, setSummary] = useState<any>(null);
  const [complaints, setComplaints] = useState<any[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mailDebug, setMailDebug] = useState<any>(null);
  const [msg, setMsg] = useState("");

  const [focus, setFocus] = useState<Focus>("none");
  const [filterDate, setFilterDate] = useState("");
  const [viewMode, setViewMode] = useState<"unassigned" | "assigned">("unassigned");
  const [priorityFilter, setPriorityFilter] = useState<"ALL" | Priority>("ALL");
  const [sortBy, setSortBy] = useState<SortBy>("created_desc");
  const [employeeTab, setEmployeeTab] = useState<"active" | "completed">("active");

  const [lookupKey, setLookupKey] = useState("");
  const [lookupResult, setLookupResult] = useState<any | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const seenNotificationIds = useRef<Set<number>>(new Set());
  const notificationsInitialized = useRef(false);

  const privileged = useMemo(() => user.role === "OWNER" || user.role === "MANAGER", [user.role]);
  const defaultDeadline = useMemo(() => currentLocalDateTimeInput(), []);

  async function loadData() {
    const summaryReq = api("/api/dashboard/summary");
    const notificationsReq = api("/api/notifications");

    const [summaryRes, notificationsRes] = await Promise.allSettled([summaryReq, notificationsReq]);
    if (summaryRes.status === "fulfilled") setSummary(summaryRes.value);
    if (notificationsRes.status === "fulfilled") setNotifications(notificationsRes.value as Notification[]);

    if (privileged) {
      const [complaintsRes, tasksRes, employeesRes, mailRes] = await Promise.allSettled([
        api("/api/complaints"),
        api("/api/tasks"),
        api("/api/users/employees"),
        user.role === "OWNER" ? api("/api/system/mail-status") : Promise.resolve(null)
      ]);

      const serverComplaints = complaintsRes.status === "fulfilled" ? (complaintsRes.value as any[]) : [];
      if (ENABLE_LOCAL_COMPLAINT_STORAGE) {
        const localComplaints = readLocalComplaints().map((c) => ({
          id: c.serverComplaintId || c.localId,
          description: c.description,
          priority: c.priority,
          status: c.status,
          created_at: c.created_at,
          attachment_path: null,
          organization_name: c.organization_name,
          contact_name: c.contact_name,
          client_email: c.client_email,
          client_phone: c.client_phone,
          task_id: null,
          _local_only: !c.serverComplaintId
        }));
        const serverIds = new Set(serverComplaints.map((c: any) => Number(c.id)));
        const merged = [...serverComplaints, ...localComplaints.filter((c) => c._local_only || !serverIds.has(Number(c.id)))];
        setComplaints(merged);
      } else {
        setComplaints(serverComplaints);
      }
      if (tasksRes.status === "fulfilled") setTasks(tasksRes.value as TaskItem[]);
      if (employeesRes.status === "fulfilled") setEmployees(employeesRes.value as any[]);
      if (user.role === "OWNER" && mailRes.status === "fulfilled") setMailDebug(mailRes.value);
    } else {
      const myTasks = await api("/api/tasks/my");
      setTasks(myTasks as TaskItem[]);
    }
  }

  useEffect(() => {
    loadData().catch((err) => setMsg(err.message));
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      loadData().catch(() => {});
    }, 10000);
    return () => window.clearInterval(id);
  }, []);

  function showToast(message: string) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  }

  useEffect(() => {
    const unread = notifications.filter((n) => !n.read);
    if (!notificationsInitialized.current) {
      notificationsInitialized.current = true;
      for (const n of unread) seenNotificationIds.current.add(n.id);
      return;
    }

    const fresh = unread.filter((n) => !seenNotificationIds.current.has(n.id));
    if (fresh.length === 0) return;

    for (const n of fresh) {
      seenNotificationIds.current.add(n.id);
      showToast(n.message);

      if (typeof window !== "undefined" && "Notification" in window) {
        if (window.Notification.permission === "granted") {
          new window.Notification("New Task Notification", { body: n.message });
        } else if (window.Notification.permission === "default") {
          window.Notification.requestPermission().then((perm) => {
            if (perm === "granted") {
              new window.Notification("New Task Notification", { body: n.message });
            }
          }).catch(() => {});
        }
      }
    }
  }, [notifications]);

  function isSameDay(value: string, target: string): boolean {
    return value.slice(0, 10) === target;
  }

  function resetFilters() {
    setFocus("none");
    setFilterDate("");
    setPriorityFilter("ALL");
    setSortBy("created_desc");
    setEmployeeTab("active");
  }

  function sortItems<T extends { created_at?: string; deadline?: string; priority?: Priority }>(items: T[]): T[] {
    const copy = [...items];
    copy.sort((a, b) => {
      if (sortBy === "created_asc") return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      if (sortBy === "created_desc") return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      if (sortBy === "deadline_asc") return new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime();
      if (sortBy === "deadline_desc") return new Date(b.deadline || 0).getTime() - new Date(a.deadline || 0).getTime();
      if (sortBy === "priority_asc") return priorityRank((a.priority || "LOW") as Priority) - priorityRank((b.priority || "LOW") as Priority);
      return priorityRank((b.priority || "LOW") as Priority) - priorityRank((a.priority || "LOW") as Priority);
    });
    return copy;
  }

  const filteredTasks = useMemo(() => {
    let out = tasks.filter((task) => {
      if (priorityFilter !== "ALL" && task.priority !== priorityFilter) return false;

      if (user.role !== "EMPLOYEE" && focus === "none" && task.status === "CLOSED") return false;
      if (focus === "pending" && !(task.status === "OPEN" || task.status === "IN_PROGRESS")) return false;
      if (focus === "closed" && task.status !== "CLOSED") return false;
      if (focus === "overdue" && !(new Date(task.deadline) < new Date() && task.status !== "CLOSED")) return false;

      if (filterDate) {
        if (focus === "overdue") return isSameDay(task.deadline, filterDate);
        return isSameDay(task.created_at, filterDate);
      }
      return true;
    });

    if (user.role === "EMPLOYEE") {
      out = out.filter((task) => (employeeTab === "active" ? task.status !== "CLOSED" : task.status === "CLOSED"));
    }

    return sortItems(out);
  }, [tasks, focus, filterDate, priorityFilter, sortBy, user.role, employeeTab]);

  const filteredComplaints = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);

    const out = complaints.filter((c) => {
      if (priorityFilter !== "ALL" && c.priority !== priorityFilter) return false;
      if (focus === "complaints_today" && !isSameDay(c.created_at, today)) return false;
      if (filterDate && !isSameDay(c.created_at, filterDate)) return false;
      return true;
    });

    return sortItems(out);
  }, [complaints, focus, filterDate, priorityFilter, sortBy]);

  async function assignTask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg("");
    const form = new FormData(e.currentTarget);

    try {
      await api("/api/tasks/from-complaint", {
        method: "POST",
        body: JSON.stringify({
          complaintId: Number(form.get("complaintId")),
          assignedToId: Number(form.get("assignedToId")),
          priority: form.get("priority"),
          deadline: form.get("deadline"),
          status: "OPEN"
        })
      });
      setMsg("Task assigned successfully.");
      await loadData();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function unassignTask(taskId: number) {
    await api(`/api/tasks/${taskId}/unassign`, { method: "POST" });
    setMsg("Task moved to unassigned complaints.");
    await loadData();
  }

  async function updateTaskStatus(taskId: number, status: TaskStatus) {
    await api(`/api/tasks/${taskId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (user.role === "EMPLOYEE" && status === "CLOSED") {
      setEmployeeTab("completed");
    }
    await loadData();
  }

  async function addUpdate(e: FormEvent<HTMLFormElement>, taskId: number) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await api(`/api/tasks/${taskId}/updates`, {
      method: "POST",
      body: JSON.stringify({
        remarks: form.get("remarks")
      })
    });
    (e.target as HTMLFormElement).reset();
    setMsg("Task update added.");
  }

  async function findComplaintByKey(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!lookupKey.trim()) return;

    setLookupLoading(true);
    setLookupResult(null);
    try {
      const data = await api(`/api/complaints/${encodeURIComponent(lookupKey.trim())}`);
      setLookupResult(data);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLookupLoading(false);
    }
  }

  async function logout() {
    const ok = window.confirm("Are you sure you want to logout?");
    if (!ok) return;
    await api("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  const metrics = summary?.metrics || {};

  return (
    <div className="grid gap">
      <div className="card split">
        <div>
          <h2>{user.role} Internal Dashboard</h2>
          <p>Welcome, {user.name}</p>
        </div>
        <button onClick={logout}>Logout</button>
      </div>

      {user.role !== "EMPLOYEE" && (
        <div className="card split">
          <div className="inline">
            <button className={viewMode === "unassigned" ? "tab-active" : ""} onClick={() => setViewMode("unassigned")}>Unassigned</button>
            <button className={viewMode === "assigned" ? "tab-active" : ""} onClick={() => setViewMode("assigned")}>Assigned</button>
            <button onClick={resetFilters}>Clear Filters</button>
          </div>
          <div className="inline">
            <label>
              Date
              <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
            </label>
            <label>
              Priority
              <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as any)}>
                <option value="ALL">All</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </label>
            <label>
              Sort
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
                <option value="created_desc">Newest</option>
                <option value="created_asc">Oldest</option>
                <option value="deadline_asc">Deadline Soon</option>
                <option value="deadline_desc">Deadline Late</option>
                <option value="priority_desc">Priority High-Low</option>
                <option value="priority_asc">Priority Low-High</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {user.role === "OWNER" && (
        <div className="metrics-grid">
          <MetricCard title="Complaints Today" value={metrics.totalComplaintsToday || 0} active={focus === "complaints_today"} onClick={() => { setFocus("complaints_today"); setViewMode("unassigned"); }} />
          <MetricCard title="Pending Tasks" value={metrics.pendingTasks || 0} active={focus === "pending"} onClick={() => { setFocus("pending"); setViewMode("assigned"); }} />
          <MetricCard title="Closed Tasks" value={metrics.closedTasks || 0} active={focus === "closed"} onClick={() => { setFocus("closed"); setViewMode("assigned"); }} />
          <MetricCard title="Overdue" value={metrics.overdueTasks || 0} active={focus === "overdue"} onClick={() => { setFocus("overdue"); setViewMode("assigned"); }} />
        </div>
      )}

      {user.role === "MANAGER" && (
        <div className="metrics-grid">
          <MetricCard title="Assigned Today" value={metrics.assignedToday || 0} />
          <MetricCard
            title="Unassigned Complaints"
            value={metrics.unassignedComplaints || 0}
            active={viewMode === "unassigned" && focus === "none"}
            onClick={() => {
              setViewMode("unassigned");
              setFocus("none");
            }}
          />
          <MetricCard title="Overdue Tasks" value={metrics.overdueTasks || 0} active={focus === "overdue"} onClick={() => { setViewMode("assigned"); setFocus("overdue"); }} />
          <MetricCard
            title="Pending Tasks"
            value={(metrics.pendingByEmployee || []).reduce((acc: number, p: any) => acc + Number(p.pending), 0)}
            active={focus === "pending"}
            onClick={() => {
              setViewMode("assigned");
              setFocus("pending");
            }}
          />
        </div>
      )}

      {user.role === "EMPLOYEE" && (
        <>
          <div className="metrics-grid">
            <MetricCard title="My Tasks" value={metrics.myTasks || 0} onClick={() => setEmployeeTab("active")} active={employeeTab === "active"} />
            <MetricCard title="Due Today" value={metrics.dueToday || 0} onClick={() => setEmployeeTab("active")} active={employeeTab === "active"} />
            <MetricCard title="Completed" value={metrics.completed || 0} onClick={() => setEmployeeTab("completed")} active={employeeTab === "completed"} />
          </div>
          <div className="inline">
            <button className={employeeTab === "active" ? "tab-active" : ""} onClick={() => setEmployeeTab("active")}>Active</button>
            <button className={employeeTab === "completed" ? "tab-active" : ""} onClick={() => setEmployeeTab("completed")}>Completed</button>
          </div>
          <BarChart
            title="Task Status Overview"
            data={[
              { label: "Open", value: metrics.openTasks || 0 },
              { label: "In Progress", value: metrics.inProgressTasks || 0 },
              { label: "Closed", value: metrics.completed || 0 }
            ]}
          />
        </>
      )}

      {user.role === "OWNER" && (
        <div className="card">
          <h3>Mail Delivery Status</h3>
          <p><b>Mode:</b> {mailDebug?.mode || "Not initialized yet"}</p>
          {mailDebug?.lastEmail && (
            <p className="small">
              Last: {mailDebug.lastEmail.subject} to {mailDebug.lastEmail.to}
              {mailDebug.lastEmail.previewUrl && (
                <>
                  {" "}- <a href={mailDebug.lastEmail.previewUrl} target="_blank" rel="noreferrer">Preview</a>
                </>
              )}
            </p>
          )}
        </div>
      )}

      {user.role === "OWNER" && (
        <BarChart
          title="Employee Performance"
          data={(metrics.employeePerformance || []).map((p: any) => ({ label: p.name, value: Number(p.completed || 0) }))}
        />
      )}

      {user.role === "MANAGER" && (
        <BarChart
          title="Pending Tasks By Employee"
          data={(metrics.pendingByEmployee || []).map((p: any) => ({ label: p.name, value: Number(p.pending || 0) }))}
        />
      )}

      <NotificationPanel notifications={notifications} refresh={loadData} />

      {privileged && (
        <div className="card lookup-card">
          <h3>Complaint Key Finder</h3>
          <form onSubmit={findComplaintByKey} className="inline">
            <input value={lookupKey} onChange={(e) => setLookupKey(e.target.value)} placeholder="Enter key: CMP-000123 or 123" />
            <button type="submit">Find</button>
          </form>
          {lookupLoading && <p className="small">Searching...</p>}
          {lookupResult && (
            <div className="lookup-result">
              <p><b>Key:</b> {lookupResult.complaintKey}</p>
              <p><b>Organization:</b> {lookupResult.complaint.organization_name}</p>
              <p><b>Contact:</b> {lookupResult.complaint.contact_name}</p>
              <p><b>Status:</b> {lookupResult.complaint.status}</p>
              <p><b>Priority:</b> {lookupResult.complaint.priority}</p>
              <p>{lookupResult.complaint.description}</p>
              {lookupResult.task && <p><b>Task:</b> #{lookupResult.task.id} ({lookupResult.task.status}) Deadline: {new Date(lookupResult.task.deadline).toLocaleString()}</p>}
            </div>
          )}
        </div>
      )}

      {privileged && viewMode === "unassigned" && (
        <div className="card">
          <h3>Unassigned Complaints</h3>
          <div className="task-list">
            {filteredComplaints.filter((c) => !c.task_id).length === 0 && <p className="small">No unassigned complaints for filter.</p>}
            {filteredComplaints
              .filter((c) => !c.task_id)
              .map((c) => (
                <div className="task-item assigner-card" key={c.id}>
                  <div className="split">
                    <strong>{complaintKey(c.id)}</strong>
                    <span className={priorityClass(c.priority)}>{c.priority}</span>
                  </div>
                  <p><b>Organization:</b> {c.organization_name}</p>
                  <p><b>Contact:</b> {c.contact_name}</p>
                  <p>{c.description}</p>
                  <form onSubmit={assignTask} className="assigner-grid">
                    <input type="hidden" name="complaintId" value={c.id} />
                    <select name="assignedToId" required>
                      <option value="">Assign Employee</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                    <select name="priority" defaultValue={c.priority || "MEDIUM"}>
                      <option value="LOW">Low Priority</option>
                      <option value="MEDIUM">Medium Priority</option>
                      <option value="HIGH">High Priority</option>
                      <option value="CRITICAL">Critical Priority</option>
                    </select>
                    <label>
                      Deadline
                      <input name="deadline" type="datetime-local" required defaultValue={defaultDeadline} />
                    </label>
                    <button type="submit">Assign Task</button>
                  </form>
                </div>
              ))}
          </div>
        </div>
      )}

      {(user.role === "EMPLOYEE" || (privileged && viewMode === "assigned")) && (
        <div className="card">
          <h3>{user.role === "EMPLOYEE" ? `${employeeTab === "active" ? "Active" : "Completed"} Tasks` : "Assigned Tasks"}</h3>
          <div className="task-list">
            {filteredTasks.length === 0 && <p className="small">No tasks for selected filter/date.</p>}
            {filteredTasks.map((task) => (
              <div key={task.id} className="task-item">
                <div className="split">
                  <strong>{complaintKey(task.complaint_id)}</strong>
                  <span className={priorityClass(task.priority)}>{task.priority}</span>
                </div>
                <p><b>Organization:</b> {task.organization_name}</p>
                <p><b>Contact:</b> {task.contact_name}</p>
                <p><b>Status:</b> {task.status}</p>
                <p><b>Deadline:</b> {new Date(task.deadline).toLocaleString()}</p>
                <p>{task.complaint_description}</p>
                <div className="inline">
                  <button onClick={() => updateTaskStatus(task.id, "OPEN")}>Open</button>
                  <button onClick={() => updateTaskStatus(task.id, "IN_PROGRESS")}>In Progress</button>
                  <button onClick={() => updateTaskStatus(task.id, "CLOSED")}>Closed</button>
                  {privileged && <button className="warn" onClick={() => unassignTask(task.id)}>Unassign</button>}
                </div>
                <form onSubmit={(e) => addUpdate(e, task.id)} className="grid">
                  <input name="remarks" placeholder="Add remarks" required />
                  <button type="submit">Add Update</button>
                </form>
              </div>
            ))}
          </div>
        </div>
      )}

      {msg && <p className="msg">{msg}</p>}

      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map((toast) => (
            <div className="toast" key={toast.id}>
              <strong>New Notification</strong>
              <span>{toast.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProtectedInternal({ user, children }: { user: User | null; children: ReactElement }) {
  if (!user) return <Navigate to="/internal/login" replace />;
  return children;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api<User>("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <div className="loading">Loading...</div>;

  return (
    <Shell user={user}>
      <Routes>
        <Route path="/" element={<Navigate to="/client/complaint" replace />} />
        <Route path="/client/complaint" element={<ClientComplaintPage />} />
        <Route path="/internal/login" element={<InternalLoginPage onLogin={setUser} />} />
        <Route
          path="/internal/dashboard"
          element={
            <ProtectedInternal user={user}>
              <InternalDashboardPage user={user!} onLogout={() => setUser(null)} />
            </ProtectedInternal>
          }
        />
      </Routes>
    </Shell>
  );
}
