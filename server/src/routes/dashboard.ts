import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { db } from "../db.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get("/summary", (req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  if (req.user!.role === "OWNER") {
    const totalComplaintsToday = db
      .prepare("SELECT COUNT(*) as count FROM complaints WHERE created_at >= ?")
      .get(todayIso) as { count: number };
    const pendingTasks = db
      .prepare("SELECT COUNT(*) as count FROM tasks WHERE status IN ('OPEN', 'IN_PROGRESS')")
      .get() as { count: number };
    const closedTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'CLOSED'").get() as { count: number };
    const overdueTasks = db
      .prepare("SELECT COUNT(*) as count FROM tasks WHERE deadline < ? AND status != 'CLOSED'")
      .get(new Date().toISOString()) as { count: number };
    const workPerManager = db
      .prepare(
        `SELECT u.id, u.name, COUNT(t.id) as tasks_created
         FROM users u LEFT JOIN tasks t ON t.assigned_by = u.id
         WHERE u.role = 'MANAGER'
         GROUP BY u.id, u.name`
      )
      .all();
    const employeePerformance = db
      .prepare(
        `SELECT u.id, u.name,
                COUNT(t.id) as total,
                SUM(CASE WHEN t.status = 'CLOSED' THEN 1 ELSE 0 END) as completed
         FROM users u LEFT JOIN tasks t ON t.assigned_to = u.id
         WHERE u.role = 'EMPLOYEE'
         GROUP BY u.id, u.name`
      )
      .all();
    const complaintsByPeriod = db
      .prepare(
        `SELECT substr(created_at, 1, 10) as day, COUNT(*) as count
         FROM complaints
         GROUP BY substr(created_at, 1, 10)
         ORDER BY day DESC
         LIMIT 30`
      )
      .all();

    res.json({
      role: "OWNER",
      metrics: {
        totalComplaintsToday: totalComplaintsToday.count,
        pendingTasks: pendingTasks.count,
        closedTasks: closedTasks.count,
        overdueTasks: overdueTasks.count,
        workPerManager,
        employeePerformance,
        complaintsByPeriod
      }
    });
    return;
  }

  if (req.user!.role === "MANAGER") {
    const assignedToday = db
      .prepare("SELECT COUNT(*) as count FROM tasks WHERE assigned_by = ? AND created_at >= ?")
      .get(req.user!.id, todayIso) as { count: number };
    const unassignedComplaints = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM complaints c
         LEFT JOIN tasks t ON t.complaint_id = c.id
         WHERE t.id IS NULL`
      )
      .get() as { count: number };
    const pendingByEmployee = db
      .prepare(
        `SELECT u.id, u.name, COUNT(t.id) as pending
         FROM users u LEFT JOIN tasks t ON t.assigned_to = u.id AND t.status IN ('OPEN', 'IN_PROGRESS')
         WHERE u.role = 'EMPLOYEE'
         GROUP BY u.id, u.name`
      )
      .all();
    const overdueTasks = db
      .prepare("SELECT COUNT(*) as count FROM tasks WHERE assigned_by = ? AND deadline < ? AND status != 'CLOSED'")
      .get(req.user!.id, new Date().toISOString()) as { count: number };

    res.json({
      role: "MANAGER",
      metrics: {
        assignedToday: assignedToday.count,
        unassignedComplaints: unassignedComplaints.count,
        pendingByEmployee,
        overdueTasks: overdueTasks.count
      }
    });
    return;
  }

  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const dueToday = db
    .prepare(
      "SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND status != 'CLOSED' AND deadline >= ? AND deadline < ?"
    )
    .get(req.user!.id, todayIso, tomorrowStart) as { count: number };
  const completed = db
    .prepare("SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND status = 'CLOSED'")
    .get(req.user!.id) as { count: number };
  const openTasks = db
    .prepare("SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND status = 'OPEN'")
    .get(req.user!.id) as { count: number };
  const inProgressTasks = db
    .prepare("SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND status = 'IN_PROGRESS'")
    .get(req.user!.id) as { count: number };
  const activeTasks = db
    .prepare("SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND status != 'CLOSED'")
    .get(req.user!.id) as { count: number };

  res.json({
    role: "EMPLOYEE",
    metrics: {
      myTasks: activeTasks.count,
      dueToday: dueToday.count,
      completed: completed.count,
      openTasks: openTasks.count,
      inProgressTasks: inProgressTasks.count
    }
  });
});
