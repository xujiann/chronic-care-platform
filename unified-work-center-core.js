"use strict";

(function exposeUnifiedWorkCenterCore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HealthUnifiedWorkCenterCore = api;
})(typeof window !== "undefined" ? window : globalThis, function createUnifiedWorkCenterCore() {
  const ACTIONS = Object.freeze({
    claim: { label: "领取", status: "processing" },
    transfer: { label: "转派", status: "assigned", requiresAssignee: true },
    remind: { label: "催办", sendsMessage: true },
    return: { label: "退回", status: "returned", requiresComment: true },
    escalate: { label: "升级", status: "escalated", requiresComment: true },
    complete: { label: "完成", status: "completed", requiresComment: true }
  });

  const DOMAIN_LINKS = Object.freeze({
    referrals: "referral-teleconsultation-about.html",
    referralTeleconsultations: "referral-teleconsultation-about.html",
    internetNursingOrders: "internet-nursing.html",
    escortServiceOrders: "escort.html",
    drugConsumableSupervisions: "drug-consumable-about.html",
    medicationPickups: "insurance.html",
    insuranceClaims: "insurance.html",
    chronicScreeningTasks: "public-health.html",
    citizenLifecycleActions: "citizen.html",
    default: "workbench.html"
  });

  function text(value, fallback = "") {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
  }

  function normalizeTask(task = {}, now = Date.now()) {
    const id = text(task.id || (task.collection && task.sourceId ? `${task.collection}:${task.sourceId}` : ""));
    const dueAt = text(task.dueAt || task.deadline || task.slaDueAt);
    const dueMs = dueAt ? Date.parse(dueAt) : Number.NaN;
    const status = text(task.status, "pending");
    const closed = ["completed", "closed", "cancelled", "已完成", "已关闭"].includes(status);
    const overdue = !closed && (task.overdue === true || (Number.isFinite(dueMs) && dueMs < now));
    return {
      ...task,
      id,
      title: text(task.title || task.name || task.subject, "未命名任务"),
      collection: text(task.collection || id.split(":")[0], "unknown"),
      sourceId: text(task.sourceId || id.split(":").slice(1).join(":")),
      role: text(task.role || task.targetRole, "unassigned"),
      domain: text(task.domain || task.category || task.collection, "综合协同"),
      status,
      priority: text(task.priority, overdue ? "urgent" : "normal"),
      assignee: text(task.assignee || task.handledByName || task.owner, "待领取"),
      dueAt,
      overdue,
      deepLink: DOMAIN_LINKS[text(task.collection)] || DOMAIN_LINKS.default
    };
  }

  function normalizeMessage(message = {}) {
    return {
      ...message,
      id: text(message.id),
      taskId: text(message.taskId),
      title: text(message.title, "任务消息"),
      body: text(message.body),
      status: text(message.status, "sent"),
      channel: text(message.channel, "in_app"),
      createdAt: text(message.createdAt || message.at)
    };
  }

  function filterTasks(tasks, filters = {}) {
    const keyword = text(filters.keyword).toLowerCase();
    return tasks.filter((task) => {
      if (filters.status && filters.status !== "all" && task.status !== filters.status) return false;
      if (filters.role && filters.role !== "all" && task.role !== filters.role) return false;
      if (filters.domain && filters.domain !== "all" && task.domain !== filters.domain && task.collection !== filters.domain) return false;
      if (filters.sla === "overdue" && !task.overdue) return false;
      if (filters.sla === "due" && (task.overdue || !task.dueAt)) return false;
      if (!keyword) return true;
      return [task.id, task.title, task.domain, task.assignee, task.status].some((value) => text(value).toLowerCase().includes(keyword));
    });
  }

  function summarize(tasks, messages = []) {
    return {
      total: tasks.length,
      pending: tasks.filter((item) => !["completed", "closed", "cancelled", "已完成", "已关闭"].includes(item.status)).length,
      overdue: tasks.filter((item) => item.overdue).length,
      unassigned: tasks.filter((item) => item.assignee === "待领取").length,
      unread: messages.filter((item) => !["read", "已读"].includes(item.status)).length
    };
  }

  function buildActionPayload(action, values = {}) {
    const definition = ACTIONS[action];
    if (!definition) throw new TypeError("不支持的任务操作");
    const comment = text(values.comment);
    const assignee = text(values.assignee);
    if (definition.requiresComment && comment.length < 2) throw new TypeError(`${definition.label}必须填写至少 2 个字符的处理说明`);
    if (definition.requiresAssignee && !assignee) throw new TypeError("转派必须选择或填写接收人");
    if (definition.sendsMessage) {
      return {
        kind: "message",
        channel: text(values.channel, "in_app"),
        targetRole: text(values.targetRole),
        title: text(values.title, "任务催办提醒"),
        body: comment || "该任务即将或已经超过处理时限，请及时处置。"
      };
    }
    return {
      kind: "action",
      action,
      status: definition.status,
      comment: [comment, assignee ? `接收人：${assignee}` : ""].filter(Boolean).join("；"),
      assignee
    };
  }

  function createClient(options = {}) {
    const fetchImpl = options.fetchImpl;
    if (typeof fetchImpl !== "function") throw new TypeError("统一工作中心需要可用的请求实现");
    const base = text(options.base, "/api").replace(/\/$/, "");
    const commandId = () => globalThis.crypto?.randomUUID?.() || `work-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    async function request(path, requestOptions = {}) {
      const response = await fetchImpl(`${base}${path}`, requestOptions);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.message || `请求失败（HTTP ${response.status}）`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    }

    return {
      async load() {
        const payload = await request("/work-center");
        return {
          tasks: (payload.tasks || []).map((item) => normalizeTask(item)),
          messages: (payload.messages || []).map(normalizeMessage),
          source: "api"
        };
      },
      act(taskId, payload) {
        return request(`/work-center/tasks/${encodeURIComponent(taskId)}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": commandId() },
          body: JSON.stringify(payload)
        });
      },
      sendMessage(taskId, payload) {
        return request(`/work-center/tasks/${encodeURIComponent(taskId)}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": commandId() },
          body: JSON.stringify(payload)
        });
      },
      receipt(messageId, expectedVersion = 0) {
        return request(`/work-center/messages/${encodeURIComponent(messageId)}/receipt`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": commandId() },
          body: JSON.stringify({ status: "read", expectedVersion })
        });
      }
    };
  }

  async function runBatch(taskIds, action, values, executor) {
    const uniqueIds = [...new Set(taskIds.map((item) => text(item)).filter(Boolean))];
    const results = [];
    for (const taskId of uniqueIds) {
      try {
        const payload = { ...buildActionPayload(action, values), expectedVersion: Number(values.taskVersions?.[taskId] ?? values.expectedVersion ?? 0) };
        const kind = payload.kind;
        delete payload.kind;
        if (kind === "action") delete payload.status;
        const result = kind === "message"
          ? await executor.sendMessage(taskId, payload)
          : await executor.act(taskId, payload);
        results.push({ taskId, ok: true, result });
      } catch (error) {
        results.push({ taskId, ok: false, error: error.message || "操作失败" });
      }
    }
    return {
      results,
      succeeded: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length
    };
  }

  return { ACTIONS, DOMAIN_LINKS, normalizeTask, normalizeMessage, filterTasks, summarize, buildActionPayload, createClient, runBatch };
});
