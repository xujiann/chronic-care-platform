(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ResidentMiniProgramAdapter = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const PREFERENCE_KEYS = new Set(["largeText", "highContrast"]);
  const NAVIGATION_ROUTES = new Set([
    "home", "messages", "profile", "health-record", "emr", "registration",
    "nursing", "escort", "family-doctor", "emergency", "tasks"
  ]);
  const NAVIGATION_PARAMETER_KEYS = new Set(["messageId", "recordId", "sourceId"]);
  const RESULT_MESSAGES = Object.freeze({
    success: "平台操作已受理",
    cancelled: "已取消平台操作",
    denied: "平台权限未获允许",
    timeout: "平台响应超时，请重试",
    unsupported: "当前环境不支持此项能力",
    invalid: "平台操作参数不安全",
    failed: "平台操作失败，请重试"
  });

  function createResult(runtime, status, capability) {
    return Object.freeze({
      ok: status === "success",
      runtime,
      capability,
      status,
      message: RESULT_MESSAGES[status] || RESULT_MESSAGES.failed
    });
  }

  function classifyFailure(value) {
    const text = String(value || "").toLowerCase();
    if (/cancel|取消/.test(text)) return "cancelled";
    if (/deny|denied|auth|permission|拒绝|权限/.test(text)) return "denied";
    if (/timeout|超时/.test(text)) return "timeout";
    return "failed";
  }

  function safeIdentifier(value, maximum = 220) {
    const text = String(value ?? "").trim().slice(0, maximum);
    return text && /^[A-Za-z0-9._:-]+$/.test(text) ? text : "";
  }

  function sanitizeNavigation(route, params = {}) {
    if (!NAVIGATION_ROUTES.has(route)) return null;
    if (!params || typeof params !== "object" || Array.isArray(params)) return null;
    const safeParams = {};
    for (const [key, rawValue] of Object.entries(params)) {
      if (!NAVIGATION_PARAMETER_KEYS.has(key)) return null;
      const value = safeIdentifier(rawValue);
      if (!value) return null;
      safeParams[key] = value;
    }
    return { route, params: safeParams };
  }

  function createAdapter(environment = globalThis) {
    const runtime = environment.wx ? "wechat" : environment.my ? "alipay" : "web";
    const storageKey = "resident-mini-program-preferences";

    function getPreferenceStore() {
      try {
        if (runtime === "wechat" && environment.wx?.getStorageSync) return environment.wx.getStorageSync(storageKey) || {};
        if (runtime === "alipay" && environment.my?.getStorageSync) return environment.my.getStorageSync({ key: storageKey })?.data || {};
        return JSON.parse(environment.localStorage?.getItem(storageKey) || "{}");
      } catch (error) {
        return {};
      }
    }

    function setPreference(name, value) {
      if (!PREFERENCE_KEYS.has(name)) return false;
      const next = Object.fromEntries(
        [...PREFERENCE_KEYS].map((key) => [key, key === name ? Boolean(value) : Boolean(getPreferenceStore()[key])])
      );
      if (runtime === "wechat" && environment.wx?.setStorageSync) environment.wx.setStorageSync(storageKey, next);
      else if (runtime === "alipay" && environment.my?.setStorageSync) environment.my.setStorageSync({ key: storageKey, data: next });
      else environment.localStorage?.setItem(storageKey, JSON.stringify(next));
      return true;
    }

    function bridgeCall(capability, executor, options = {}) {
      const requested = Number(options.timeoutMs || 5000);
      const timeoutMs = Math.max(200, Math.min(Number.isFinite(requested) ? requested : 5000, 10000));
      return new Promise((resolve) => {
        let settled = false;
        const finish = (status) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(createResult(runtime, status, capability));
        };
        const timer = setTimeout(() => finish("timeout"), timeoutMs);
        try {
          executor({
            success: () => finish("success"),
            fail: (error) => finish(classifyFailure(error?.errMsg || error?.errorMessage || error?.message))
          });
        } catch (error) {
          finish(classifyFailure(error?.message));
        }
      });
    }

    async function navigate(route, params = {}, options = {}) {
      const target = sanitizeNavigation(route, params);
      if (!target) return createResult(runtime, "invalid", "navigation");
      const query = new URLSearchParams({ page: target.route, ...target.params }).toString();
      if (runtime === "wechat") {
        if (!environment.wx?.navigateTo) return createResult(runtime, "unsupported", "navigation");
        return bridgeCall("navigation", (callbacks) => environment.wx.navigateTo({
          url: `/pages/resident/index?${query}`,
          ...callbacks
        }), options);
      }
      if (runtime === "alipay") {
        if (!environment.my?.navigateTo) return createResult(runtime, "unsupported", "navigation");
        return bridgeCall("navigation", (callbacks) => environment.my.navigateTo({
          url: `/pages/resident/index?${query}`,
          ...callbacks
        }), options);
      }
      if (!environment.history?.pushState || !environment.location?.pathname) {
        return createResult(runtime, "unsupported", "navigation");
      }
      environment.history.pushState({ route: target.route }, "", `${environment.location.pathname}?${query}`);
      if (environment.CustomEvent && environment.dispatchEvent) {
        environment.dispatchEvent(new environment.CustomEvent("resident-mini-program:navigate", {
          detail: { route: target.route, params: target.params }
        }));
      }
      return createResult(runtime, "success", "navigation");
    }

    async function makeEmergencyCall(options = {}) {
      if (runtime === "wechat") {
        if (!environment.wx?.makePhoneCall) return createResult(runtime, "unsupported", "phone-call");
        return bridgeCall("phone-call", (callbacks) => environment.wx.makePhoneCall({ phoneNumber: "120", ...callbacks }), options);
      }
      if (runtime === "alipay") {
        if (!environment.my?.makePhoneCall) return createResult(runtime, "unsupported", "phone-call");
        return bridgeCall("phone-call", (callbacks) => environment.my.makePhoneCall({ number: "120", ...callbacks }), options);
      }
      return createResult(runtime, "unsupported", "phone-call");
    }

    function probeCapabilities() {
      return Object.freeze({
        runtime,
        navigation: runtime === "web" ? Boolean(environment.history?.pushState) : Boolean((environment.wx || environment.my)?.navigateTo),
        phoneCall: Boolean((environment.wx || environment.my)?.makePhoneCall),
        lifecycle: runtime === "web"
          ? Boolean(environment.document?.addEventListener)
          : Boolean((environment.wx || environment.my)?.onAppShow)
      });
    }

    function onLifecycle(listener) {
      if (typeof listener !== "function") return () => {};
      const cleanups = [];
      const bind = (target, name, handler, removeName = "") => {
        if (typeof target?.[name] !== "function") return;
        target[name](handler);
        if (removeName && typeof target?.[removeName] === "function") cleanups.push(() => target[removeName](handler));
      };
      if (runtime === "wechat") {
        bind(environment.wx, "onAppShow", () => listener("foreground"), "offAppShow");
        bind(environment.wx, "onAppHide", () => listener("background"), "offAppHide");
      } else if (runtime === "alipay") {
        bind(environment.my, "onAppShow", () => listener("foreground"), "offAppShow");
        bind(environment.my, "onAppHide", () => listener("background"), "offAppHide");
      } else {
        const visibility = () => listener(environment.document.visibilityState === "hidden" ? "background" : "foreground");
        const pageShow = () => listener("foreground");
        const pageHide = () => listener("background");
        environment.document?.addEventListener?.("visibilitychange", visibility);
        environment.addEventListener?.("pageshow", pageShow);
        environment.addEventListener?.("pagehide", pageHide);
        cleanups.push(() => {
          environment.document?.removeEventListener?.("visibilitychange", visibility);
          environment.removeEventListener?.("pageshow", pageShow);
          environment.removeEventListener?.("pagehide", pageHide);
        });
      }
      return () => cleanups.forEach((cleanup) => cleanup());
    }

    function platformLabel() {
      return runtime === "wechat" ? "微信小程序" : runtime === "alipay" ? "支付宝小程序" : "移动网页预览";
    }

    return {
      runtime,
      getPreferences: getPreferenceStore,
      makeEmergencyCall,
      navigate,
      onLifecycle,
      platformLabel,
      probeCapabilities,
      setPreference
    };
  }

  return {
    NAVIGATION_PARAMETER_KEYS,
    NAVIGATION_ROUTES,
    PREFERENCE_KEYS,
    RESULT_MESSAGES,
    classifyFailure,
    createAdapter,
    sanitizeNavigation
  };
});
