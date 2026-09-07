"use strict";

(function exposeCitizenServiceFeedback(root, factory) {
  const api = Object.freeze(factory(root));
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CitizenServiceFeedback = api;
})(typeof window !== "undefined" ? window : globalThis, function createCitizenServiceFeedback(root) {
  const supportedCollections = new Set(["escortServiceOrders", "internetNursingOrders"]);
  const eligibleStatuses = new Set(["completed", "quality-review", "closed"]);
  const satisfactionOptions = new Set(["非常满意", "满意", "一般", "不满意", "非常不满意"]);

  function taskStatus(item) {
    return String(item?.rawStatus || item?.status || "").trim();
  }

  function hasSubmittedFeedback(item) {
    return item?.taskAction === "quality-feedback"
      || item?.qualityReview === "citizen-feedback"
      || item?.qualityCallback === "citizen-feedback";
  }

  function isCompletedService(item) {
    return eligibleStatuses.has(taskStatus(item));
  }

  function isFeedbackEligible(item) {
    return supportedCollections.has(String(item?.collection || ""))
      && isCompletedService(item)
      && !hasSubmittedFeedback(item);
  }

  function shouldIncludeOrder(item, collection) {
    const status = taskStatus(item);
    const open = !["closed", "completed", "quality-review", "cancel-requested", "cancelled", "canceled"].includes(status);
    return open || isFeedbackEligible({ ...item, collection });
  }

  function shouldIncludeEscortOrder(item) {
    return shouldIncludeOrder(item, "escortServiceOrders");
  }

  function shouldIncludeNursingOrder(item) {
    return shouldIncludeOrder(item, "internetNursingOrders");
  }

  function buildPayload(input = {}) {
    const satisfaction = String(input.satisfaction || "").trim();
    const comment = String(input.comment || "").trim();
    if (!satisfactionOptions.has(satisfaction)) throw new Error("请选择总体满意度");
    if (comment.length < 2) throw new Error("请填写至少 2 个字符的评价内容");
    return {
      action: "quality-feedback",
      comment,
      satisfaction,
      complaintStatus: input.complaintRequested === true || input.complaintRequested === "open" ? "open" : "none"
    };
  }

  function replaceTaskItem(primaryRows, mirrorRows, updated) {
    for (const rows of [primaryRows, mirrorRows]) {
      if (!Array.isArray(rows)) continue;
      const index = rows.findIndex((item) => item.id === updated?.id);
      if (index >= 0) rows[index] = updated;
    }
  }

  function createDialogController(document, submitTaskAction, showToast = () => {}, render = () => {}) {
    const dialog = document?.querySelector("#service-quality-feedback-dialog");
    const form = document?.querySelector("#service-quality-feedback-form");
    const error = document?.querySelector("#service-quality-feedback-error");
    const title = document?.querySelector("#service-quality-feedback-title");
    if (!dialog || !form || !error || typeof submitTaskAction !== "function") return null;
    let activeButton = null;

    function reset() {
      form.reset();
      delete form.dataset.taskKey;
      error.textContent = "";
    }

    function close() {
      reset();
      dialog.close();
    }

    document.querySelectorAll("[data-quality-feedback-cancel]").forEach((button) => button.addEventListener("click", close));
    dialog.addEventListener("cancel", reset);
    dialog.addEventListener("close", () => {
      if (activeButton) activeButton.disabled = false;
      activeButton = null;
      const submit = form.querySelector("button[type='submit']");
      if (submit) submit.disabled = false;
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const sourceButton = activeButton;
      if (!sourceButton) {
        error.textContent = "未找到需要评价的服务，请关闭后重试。";
        return;
      }
      let payload;
      try {
        const data = Object.fromEntries(new root.FormData(form));
        payload = buildPayload({
          satisfaction: data.satisfaction,
          comment: data.comment,
          complaintRequested: data.complaintRequested === "open"
        });
      } catch (validationError) {
        error.textContent = validationError.message || "请核对评价内容";
        return;
      }
      const submit = form.querySelector("button[type='submit']");
      sourceButton.disabled = true;
      if (submit) submit.disabled = true;
      error.textContent = "正在提交评价…";
      try {
        await submitTaskAction(sourceButton.dataset.taskId, sourceButton.dataset.taskCollection, payload);
        close();
        showToast(payload.complaintStatus === "open" ? "评价已提交，服务机构将跟进处理" : "服务评价已提交");
        render();
      } catch (submitError) {
        error.textContent = submitError.message || "服务评价提交失败，请重试";
        showToast("服务评价提交失败，已保留填写内容");
      } finally {
        if (dialog.open) {
          sourceButton.disabled = false;
          if (submit) submit.disabled = false;
        }
      }
    });

    return Object.freeze({
      open(button) {
        if (!button) return false;
        const taskKey = `${button.dataset.taskCollection}:${button.dataset.taskId}`;
        if (form.dataset.taskKey !== taskKey) {
          form.reset();
          form.dataset.taskKey = taskKey;
        }
        activeButton = button;
        if (title) title.textContent = `${button.dataset.taskCollection === "internetNursingOrders" ? "互联网护理" : "助医陪诊"}服务评价`;
        error.textContent = "";
        dialog.showModal();
        form.elements.satisfaction.focus();
        return true;
      }
    });
  }

  return {
    buildPayload,
    createDialogController,
    hasSubmittedFeedback,
    isCompletedService,
    isFeedbackEligible,
    replaceTaskItem,
    shouldIncludeEscortOrder,
    shouldIncludeNursingOrder,
    shouldIncludeOrder,
    taskStatus
  };
});
