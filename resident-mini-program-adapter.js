(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ResidentMiniProgramAdapter = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const PREFERENCE_KEYS = new Set(["largeText", "highContrast"]);

  function createAdapter(environment = globalThis) {
    const runtime = environment.wx ? "wechat" : environment.my ? "alipay" : "web";
    const storageKey = "resident-mini-program-preferences";

    function getPreferenceStore() {
      if (runtime === "wechat" && environment.wx?.getStorageSync) return environment.wx.getStorageSync(storageKey) || {};
      if (runtime === "alipay" && environment.my?.getStorageSync) return environment.my.getStorageSync({ key: storageKey })?.data || {};
      try {
        return JSON.parse(environment.localStorage?.getItem(storageKey) || "{}");
      } catch (error) {
        return {};
      }
    }

    function setPreference(name, value) {
      if (!PREFERENCE_KEYS.has(name)) return false;
      const next = { ...getPreferenceStore(), [name]: Boolean(value) };
      if (runtime === "wechat" && environment.wx?.setStorageSync) environment.wx.setStorageSync(storageKey, next);
      else if (runtime === "alipay" && environment.my?.setStorageSync) environment.my.setStorageSync({ key: storageKey, data: next });
      else environment.localStorage?.setItem(storageKey, JSON.stringify(next));
      return true;
    }

    function navigate(route, params = {}) {
      const query = new URLSearchParams({ page: route, ...params }).toString();
      if (runtime === "wechat" && environment.wx?.navigateTo) {
        environment.wx.navigateTo({ url: `/pages/resident/index?${query}` });
        return;
      }
      if (runtime === "alipay" && environment.my?.navigateTo) {
        environment.my.navigateTo({ url: `/pages/resident/index?${query}` });
        return;
      }
      const target = `${environment.location.pathname}?${query}`;
      environment.history?.pushState({ route }, "", target);
      environment.dispatchEvent?.(new environment.CustomEvent("resident-mini-program:navigate", { detail: { route, params } }));
    }

    function platformLabel() {
      return runtime === "wechat" ? "微信小程序" : runtime === "alipay" ? "支付宝小程序" : "移动网页预览";
    }

    return {
      runtime,
      getPreferences: getPreferenceStore,
      setPreference,
      navigate,
      platformLabel
    };
  }

  return { PREFERENCE_KEYS, createAdapter };
});
