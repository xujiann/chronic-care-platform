"use strict";

(function exposeStructuredDialog(root) {
  let activeResolve = null;

  function element(tag, className, text) {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function ensureDialog() {
    let dialog = root.document.querySelector("#health-structured-dialog");
    if (dialog) return dialog;
    dialog = element("dialog", "health-structured-dialog");
    dialog.id = "health-structured-dialog";
    const form = element("form", "health-structured-dialog-card");
    form.method = "dialog";
    const heading = element("h2", "", "填写操作信息");
    heading.id = "health-structured-dialog-title";
    const label = element("label", "health-structured-dialog-field");
    const labelText = element("span", "", "内容");
    const input = element("textarea");
    input.name = "value";
    input.rows = 3;
    input.autocomplete = "off";
    label.append(labelText, input);
    const helper = element("p", "muted");
    const error = element("p", "health-structured-dialog-error");
    error.setAttribute("aria-live", "polite");
    const footer = element("footer");
    const cancel = element("button", "ghost-button", "取消");
    cancel.type = "button";
    cancel.dataset.dialogCancel = "";
    const submit = element("button", "primary-button", "确认");
    submit.type = "submit";
    footer.append(cancel, submit);
    form.append(heading, label, helper, error, footer);
    dialog.append(form);
    dialog.setAttribute("aria-labelledby", heading.id);
    root.document.body.append(dialog);

    const finish = (value) => {
      const resolve = activeResolve;
      activeResolve = null;
      if (dialog.open) dialog.close();
      resolve?.(value);
    };
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value.trim();
      const minLength = Number(input.dataset.minLength || 0);
      const pattern = input.dataset.pattern ? new RegExp(input.dataset.pattern) : null;
      if (input.required && !value) {
        error.textContent = "此项不能为空。";
        input.focus();
        return;
      }
      if (minLength && value.length < minLength) {
        error.textContent = `至少填写 ${minLength} 个字符。`;
        input.focus();
        return;
      }
      if (pattern && !pattern.test(value)) {
        error.textContent = input.dataset.patternMessage || "填写内容格式不正确。";
        input.focus();
        return;
      }
      finish(value);
    });
    return dialog;
  }

  function prompt(options = {}) {
    const config = typeof options === "string" ? { title: options } : options;
    const dialog = ensureDialog();
    if (activeResolve) activeResolve(null);
    const heading = dialog.querySelector("h2");
    const labelText = dialog.querySelector("label > span");
    const input = dialog.querySelector("textarea");
    const helper = dialog.querySelector(".muted");
    const error = dialog.querySelector(".health-structured-dialog-error");
    heading.textContent = String(config.title || "填写操作信息");
    labelText.textContent = String(config.label || config.title || "内容");
    input.value = String(config.defaultValue || "");
    input.required = config.required !== false;
    input.dataset.minLength = String(config.minLength || 0);
    input.dataset.pattern = config.pattern || "";
    input.dataset.patternMessage = config.patternMessage || "";
    input.rows = config.multiline === false ? 1 : Number(config.rows || 3);
    helper.textContent = String(config.helperText || "提交前请核对内容，操作将按当前登录身份记录审计。 ");
    error.textContent = "";
    dialog.showModal();
    root.setTimeout(() => input.focus(), 0);
    return new Promise((resolve) => { activeResolve = resolve; });
  }

  root.HealthStructuredDialog = Object.freeze({ prompt });
})(typeof window !== "undefined" ? window : globalThis);
