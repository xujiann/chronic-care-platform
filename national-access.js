(function () {
  const apiBase = "/api/national-access";
  const auth = window.HealthCityAuth;
  const user = auth.getUser();
  let center = null;
  let sdkManifest = null;

  const statusLabels = {
    submitted: "待核验",
    verified: "已核验",
    active: "已激活",
    suspended: "已暂停",
    requested: "已申请",
    approved: "已审批",
    cancelled: "已取消",
    healthy: "健康",
    degraded: "降级",
    unavailable: "不可用",
    ready: "可路由",
    failover: "故障转移",
    prepared: "已准备",
    configured: "已配置",
    acknowledged: "已回执",
    revoked: "已吊销",
    expired: "已过期",
    accepted: "已受理",
    passed: "已通过",
    conditional: "有条件通过",
    failed: "未通过",
    compatible: "兼容",
    conflict: "冲突",
    rejected: "已驳回",
    open: "未恢复",
    resolved: "已恢复",
    critical: "严重",
    warning: "警告"
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function label(value) {
    return statusLabels[value] || String(value || "—");
  }

  function badge(value) {
    const className = ["unavailable", "suspended", "cancelled", "revoked", "expired", "failed", "conflict", "rejected", "critical"].includes(value)
      ? "danger"
      : ["degraded", "submitted", "requested", "conditional", "failover", "warning"].includes(value)
        ? "warn"
        : "info";
    return `<span class="badge ${className}">${escapeHtml(label(value))}</span>`;
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleString("zh-CN", { hour12: false });
  }

  function showMessage(message, type = "info") {
    const element = document.getElementById("national-access-message");
    element.className = `national-access-message ${type}`;
    element.textContent = message;
  }

  async function request(pathname, options = {}) {
    const response = await auth.authFetch(`${apiBase}${pathname}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || payload.error || `请求失败（${response.status}）`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function renderMetrics() {
    const metrics = [
      ["节点", center.summary.nodes, `${center.summary.activeNodes}个已激活`],
      ["接入机构", center.summary.institutions, `${center.summary.activeInstitutions}家已认证`],
      ["服务包", center.summary.servicePackages, "按需选择、组合开通"],
      ["活动订阅", center.summary.activeSubscriptions, "通过依赖和权限校验"],
      ["有效授权", center.summary.activeConsentAuthorizations, "按机构、合同和用途精确校验"],
      ["接入适配器", center.summary.integrationAdapters, `${center.summary.verifiedIntegrationAdapters}个已认证`],
      ["回调待回执", center.summary.pendingCallbackDeliveries, `${center.summary.activeCallbackSubscriptions}个活动订阅`],
      ["健康节点", center.summary.healthyNodes, `${center.summary.degradedNodes}个降级`],
      ["路由记录", center.summary.routesPlanned, `${center.summary.routingEnvelopes}个交换信封`],
      ["安全凭证", center.summary.activeCertificates, `${center.summary.activeDeveloperCredentials}个活动密钥`],
      ["API调用", center.summary.apiCalls, "幂等调用按密钥计量"],
      ["安全告警", center.summary.openSecurityAlerts, `${center.summary.validCertificationReports}份有效认证`],
      ["运行告警", center.summary.openSlaAlerts, `${center.summary.standardConflicts}个标准冲突`]
    ];
    document.getElementById("national-access-metrics").innerHTML = metrics.map(([name, value, detail]) => `
      <article class="metric-card">
        <span>${escapeHtml(name)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(detail)}</small>
      </article>
    `).join("");
    const ready = document.getElementById("cross-province-ready");
    ready.textContent = center.summary.crossProvinceLabSharingReady ? "跨省检验检查已具备基线" : "跨省检验检查未就绪";
    ready.className = `badge ${center.summary.crossProvinceLabSharingReady ? "info" : "warn"}`;
  }

  function renderPackages() {
    document.getElementById("service-package-count").textContent = `${center.servicePackages.length}项`;
    document.getElementById("national-service-packages").innerHTML = center.servicePackages.map((item) => `
      <article class="national-package-card">
        <div class="panel-title">
          <div>
            <small>${escapeHtml(item.code)} · v${escapeHtml(item.version)}</small>
            <h3>${escapeHtml(item.name)}</h3>
          </div>
          ${badge(item.status)}
        </div>
        <p>${escapeHtml(item.dataPolicy)}</p>
        <ul>${(item.capabilities || []).map((capability) => `<li>${escapeHtml(capability)}</li>`).join("")}</ul>
        <small>依赖：${item.requiredPackageIds?.length ? item.requiredPackageIds.map(escapeHtml).join("、") : "无"}</small>
      </article>
    `).join("");
  }

  function entityActions(kind, item) {
    if (user.role !== "commission") return "";
    const actions = {
      submitted: [["verify", "核验"], ["suspend", "暂停"]],
      verified: [["activate", "激活"], ["suspend", "暂停"]],
      active: [["suspend", "暂停"]],
      suspended: [["verify", "重新核验"], ["activate", "恢复激活"]]
    }[item.status] || [];
    return actions.map(([action, text]) => `
      <button class="ghost-button compact" type="button" data-lifecycle-kind="${kind}" data-id="${escapeHtml(item.id)}" data-action="${action}">${text}</button>
    `).join("");
  }

  function renderNodes() {
    const healthByNode = new Map(center.nodeHealth.map((item) => [item.nodeId, item.health]));
    document.getElementById("national-node-table").innerHTML = `
      <table>
        <thead><tr><th>节点</th><th>类型/区域</th><th>认证</th><th>健康</th><th>延迟</th><th>操作</th></tr></thead>
        <tbody>
          ${center.nodes.map((item) => {
            const health = healthByNode.get(item.id);
            return `<tr>
              <td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.nodeCode)}</small></td>
              <td>${escapeHtml(item.nodeType)}<small>${escapeHtml(item.regionCode)}</small></td>
              <td>${badge(item.status)}</td>
              <td>${badge(health?.status || "unavailable")}<small>${formatDate(health?.checkedAt)}</small></td>
              <td>${health ? `${escapeHtml(health.latencyMs)} ms` : "—"}</td>
              <td><div class="national-row-actions">${entityActions("nodes", item)}</div></td>
            </tr>`;
          }).join("") || `<tr><td colspan="6" class="empty-cell">暂无节点</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function renderInstitutions() {
    document.getElementById("national-institution-table").innerHTML = `
      <table>
        <thead><tr><th>机构</th><th>类型/区域</th><th>节点</th><th>租户</th><th>接入方式</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${center.institutions.map((item) => `<tr>
            <td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.orgCode)} · ${escapeHtml(item.nationalOrgCode)}</small></td>
            <td>${escapeHtml(item.institutionType)}<small>${escapeHtml(item.regionCode)}</small></td>
            <td>${escapeHtml(center.nodes.find((node) => node.id === item.nodeId)?.name || item.nodeId)}</td>
            <td>${escapeHtml(item.tenantId)}</td>
            <td>${escapeHtml(item.accessMode)}</td>
            <td>${badge(item.status)}</td>
            <td><div class="national-row-actions">${entityActions("institutions", item)}</div></td>
          </tr>`).join("") || `<tr><td colspan="7" class="empty-cell">暂无机构</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function subscriptionActions(item) {
    const actions = [];
    if (user.role === "commission") {
      if (item.status === "requested") actions.push(["approve", "审批"]);
      if (["approved", "suspended"].includes(item.status)) actions.push(["activate", "激活"]);
      if (["approved", "active"].includes(item.status)) actions.push(["suspend", "暂停"]);
    }
    if (item.status !== "cancelled" && (user.role === "commission" || item.orgCode === user.orgCode)) {
      actions.push(["cancel", "取消"]);
    }
    return actions.map(([action, text]) => `
      <button class="ghost-button compact" type="button" data-lifecycle-kind="subscriptions" data-id="${escapeHtml(item.id)}" data-action="${action}">${text}</button>
    `).join("");
  }

  function renderSubscriptions() {
    document.getElementById("national-subscription-table").innerHTML = `
      <table>
        <thead><tr><th>机构</th><th>服务包</th><th>环境</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
        <tbody>
          ${center.subscriptions.map((item) => `<tr>
            <td>${escapeHtml(item.orgCode)}</td>
            <td><strong>${escapeHtml(center.servicePackages.find((pkg) => pkg.id === item.packageId)?.name || item.packageId)}</strong><small>${escapeHtml(item.packageId)}</small></td>
            <td>${escapeHtml(item.environment)}</td>
            <td>${badge(item.status)}</td>
            <td>${formatDate(item.updatedAt)}</td>
            <td><div class="national-row-actions">${subscriptionActions(item)}</div></td>
          </tr>`).join("") || `<tr><td colspan="6" class="empty-cell">暂无订阅</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function renderRoutes() {
    document.getElementById("national-route-table").innerHTML = `
      <table>
        <thead><tr><th>请求</th><th>来源→目标</th><th>节点路径</th><th>服务包/目的</th><th>状态</th><th>预计延迟</th></tr></thead>
        <tbody>
          ${center.routingTraces.map((item) => `<tr>
            <td><strong>${escapeHtml(item.requestId)}</strong><small>${formatDate(item.plannedAt)}</small></td>
            <td>${escapeHtml(item.sourceOrgCode)} → ${escapeHtml(item.targetOrgCode)}<small>${item.crossProvince ? "跨省" : "省内"}</small></td>
            <td>${(item.hops || []).map(escapeHtml).join(" → ")}</td>
            <td>${escapeHtml(item.packageId)}<small>${escapeHtml(item.purpose)}</small></td>
            <td>${badge(item.status)}</td>
            <td>${escapeHtml(item.estimatedLatencyMs)} ms</td>
          </tr>`).join("") || `<tr><td colspan="6" class="empty-cell">尚未生成路由记录</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function certificateSubject(item) {
    if (item.subjectType === "node") {
      return center.nodes.find((node) => node.id === item.subjectId)?.name || item.subjectId;
    }
    return center.institutions.find((institution) => institution.id === item.subjectId)?.name || item.subjectId;
  }

  function renderCertificates() {
    document.getElementById("national-certificate-table").innerHTML = `
      <table>
        <thead><tr><th>证书主体</th><th>序列号/环境</th><th>公钥指纹</th><th>有效期</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${center.certificates.map((item) => `<tr>
            <td><strong>${escapeHtml(certificateSubject(item))}</strong><small>${escapeHtml(item.subjectType)} · ${escapeHtml(item.subjectId)}</small></td>
            <td>${escapeHtml(item.serialNumber)}<small>${escapeHtml(item.environment)}</small></td>
            <td><code>${escapeHtml(item.publicKeyFingerprint.slice(0, 16))}…</code></td>
            <td>${formatDate(item.expiresAt)}</td>
            <td>${badge(item.status)}</td>
            <td>${user.role === "commission" && item.status === "active"
              ? `<button class="ghost-button compact" type="button" data-lifecycle-kind="certificates" data-id="${escapeHtml(item.id)}" data-action="revoke">吊销</button>`
              : "—"}</td>
          </tr>`).join("") || `<tr><td colspan="6" class="empty-cell">暂无接入证书</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function renderCredentials() {
    document.getElementById("national-credential-table").innerHTML = `
      <table>
        <thead><tr><th>密钥</th><th>机构/环境</th><th>服务包权限</th><th>有效期</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${center.developerCredentials.map((item) => {
            const manageable = item.status === "active" && (user.role === "commission" || item.orgCode === user.orgCode);
            return `<tr>
              <td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.secretPrefix)}…</small></td>
              <td>${escapeHtml(item.orgCode)}<small>${escapeHtml(item.environment)}</small></td>
              <td>${(item.scopes || []).map((scope) => `<span class="badge info">${escapeHtml(scope)}</span>`).join(" ")}</td>
              <td>${formatDate(item.expiresAt)}</td>
              <td>${badge(item.status)}</td>
              <td><div class="national-row-actions">${manageable ? `
                <button class="ghost-button compact" type="button" data-lifecycle-kind="credentials" data-id="${escapeHtml(item.id)}" data-action="rotate">轮换</button>
                <button class="ghost-button compact" type="button" data-lifecycle-kind="credentials" data-id="${escapeHtml(item.id)}" data-action="revoke">吊销</button>
              ` : "—"}</div></td>
            </tr>`;
          }).join("") || `<tr><td colspan="6" class="empty-cell">暂无开发者密钥</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function renderEnvelopes() {
    document.getElementById("national-envelope-table").innerHTML = `
      <table>
        <thead><tr><th>追踪标识</th><th>交换合同</th><th>来源→目标</th><th>摘要/授权</th><th>状态</th><th>创建时间</th></tr></thead>
        <tbody>
          ${center.routingEnvelopes.map((item) => `<tr>
            <td><strong>${escapeHtml(item.traceId)}</strong><small>${escapeHtml(item.requestId)}</small></td>
            <td>${escapeHtml(item.contractId)}<small>v${escapeHtml(item.schemaVersion)}</small></td>
            <td>${escapeHtml(item.sourceOrgCode)} → ${escapeHtml(item.targetOrgCode)}<small>${(item.hops || []).map(escapeHtml).join(" → ")}</small></td>
            <td><code>${escapeHtml(item.payloadDigest.slice(0, 16))}…</code><small>${escapeHtml(item.consentReference)}</small></td>
            <td>${badge(item.status)}<small>不含业务载荷</small></td>
            <td>${formatDate(item.createdAt)}</td>
          </tr>`).join("") || `<tr><td colspan="6" class="empty-cell">暂无路由信封</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function consentActions(item) {
    const manageable = item.status === "active"
      && (user.role === "commission" || item.sourceOrgCode === user.orgCode);
    return manageable
      ? `<button class="ghost-button compact" type="button" data-lifecycle-kind="consents" data-id="${escapeHtml(item.id)}" data-action="revoke">撤销</button>`
      : "—";
  }

  function renderConsents() {
    document.getElementById("national-consent-table").innerHTML = `
      <table>
        <thead><tr><th>授权引用</th><th>来源→目标</th><th>服务包/合同</th><th>用途/依据</th><th>有效期</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${center.consentAuthorizations.map((item) => `<tr>
            <td><strong><code>${escapeHtml(item.reference)}</code></strong><small>${escapeHtml(item.residentReference)}</small></td>
            <td>${escapeHtml(item.sourceOrgCode)} → ${escapeHtml((item.targetOrgCodes || []).join("、"))}</td>
            <td>${(item.packageIds || []).map((value) => `<code>${escapeHtml(value)}</code>`).join("<br />")}
              <small>${(item.contractIds || []).map(escapeHtml).join("、")}</small>
            </td>
            <td>${escapeHtml(item.purpose)}<small>${escapeHtml(item.legalBasis)}</small></td>
            <td>${formatDate(item.validFrom)}<small>至 ${formatDate(item.validUntil)}</small></td>
            <td>${badge(item.status)}<small>证据仅存摘要</small></td>
            <td>${consentActions(item)}</td>
          </tr>`).join("") || `<tr><td colspan="7" class="empty-cell">暂无授权记录</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function renderSdkManifest() {
    const table = document.getElementById("national-sdk-contract-table");
    const example = document.getElementById("national-sdk-example");
    if (!sdkManifest) {
      table.innerHTML = `<p class="empty-cell">接入合同清单尚未加载。</p>`;
      example.textContent = "接入示例尚未加载。";
      return;
    }
    table.innerHTML = `
      <table>
        <thead><tr><th>交换合同</th><th>适用服务包</th><th>授权要求</th><th>载荷策略</th><th>生产状态</th></tr></thead>
        <tbody>
          ${sdkManifest.contracts.map((item) => `<tr>
            <td><strong>${escapeHtml(item.id)}</strong></td>
            <td>${(item.packageIds || []).map((value) => `<code>${escapeHtml(value)}</code>`).join("<br />")}</td>
            <td>${item.requiresConsent ? "必须提供有效授权" : "无需居民授权"}</td>
            <td>${item.metadataOnly ? "仅元数据与摘要" : "—"}</td>
            <td><span class="badge danger">${item.productionReady ? "已开放" : "保持阻断"}</span></td>
          </tr>`).join("") || `<tr><td colspan="5" class="empty-cell">当前机构尚无可调用合同，请先激活服务包。</td></tr>`}
        </tbody>
      </table>
    `;
    const manifestExample = sdkManifest.example || {};
    example.textContent = [
      '<script src="/national-access-developer-sdk.js"></script>',
      "<script>",
      "const client = new NationalHealthAccessSdk.NationalHealthAccessClient({",
      `  baseUrl: "${window.location.origin}",`,
      '  apiKey: "仅在内存中使用的一次性开发者密钥"',
      "});",
      "await client.invoke({",
      `  packageId: "${manifestExample.packageId || ""}",`,
      `  contractId: "${manifestExample.contractId || ""}",`,
      '  idempotencyKey: client.createIdempotencyKey("lis"),',
      `  payloadDigest: "${manifestExample.payloadDigest || "0".repeat(64)}"`,
      "});",
      "<\/script>"
    ].join("\n");
  }

  function adapterActions(item) {
    const actions = [];
    if (user.role === "commission" && ["configured", "suspended"].includes(item.status)) {
      actions.push(["verify", "认证"]);
    }
    if (["configured", "verified"].includes(item.status)
      && (user.role === "commission" || item.orgCode === user.orgCode)) {
      actions.push(["suspend", "暂停"]);
    }
    return actions.map(([action, text]) => `
      <button class="ghost-button compact" type="button" data-lifecycle-kind="adapters" data-id="${escapeHtml(item.id)}" data-action="${action}">${text}</button>
    `).join("") || "—";
  }

  function renderAdapters() {
    document.getElementById("national-adapter-table").innerHTML = `
      <table>
        <thead><tr><th>机构/系统</th><th>厂商/版本</th><th>环境/端点引用</th><th>合同范围</th><th>证书</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${center.integrationAdapters.map((item) => `<tr>
            <td><strong>${escapeHtml(item.orgCode)} · ${escapeHtml(item.systemType)}</strong><small>${escapeHtml(item.name)}</small></td>
            <td>${escapeHtml(item.vendor || "—")}<small>${escapeHtml(item.systemVersion || "—")}</small></td>
            <td>${escapeHtml(item.environment)}<small><code>${escapeHtml(item.endpointReference)}</code></small></td>
            <td>${(item.supportedContracts || []).map((value) => `<code>${escapeHtml(value)}</code>`).join("<br />")}</td>
            <td><code>${escapeHtml(item.certificateId)}</code><small>配置仅存摘要</small></td>
            <td>${badge(item.status)}<small>${item.productionReady ? "生产开放" : "生产阻断"}</small></td>
            <td><div class="national-row-actions">${adapterActions(item)}</div></td>
          </tr>`).join("") || `<tr><td colspan="7" class="empty-cell">暂无机构适配器</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function renderContractTests() {
    document.getElementById("national-contract-test-table").innerHTML = `
      <table>
        <thead><tr><th>执行时间</th><th>机构/系统</th><th>交换合同</th><th>检查结果</th><th>证据摘要</th><th>状态</th></tr></thead>
        <tbody>
          ${center.contractTestRuns.map((item) => `<tr>
            <td>${formatDate(item.executedAt)}<small>${escapeHtml(item.executedBy)}</small></td>
            <td>${escapeHtml(item.orgCode)}<small>${escapeHtml(item.systemType)} · ${escapeHtml(item.environment)}</small></td>
            <td><code>${escapeHtml(item.contractId)}</code></td>
            <td>${escapeHtml(item.passedChecks)}/${escapeHtml(item.totalChecks)}<small>${(item.checklist || []).filter((check) => !check.passed).map((check) => check.check).join("、") || "全部通过"}</small></td>
            <td><code>${escapeHtml(item.evidenceDigest.slice(0, 16))}…</code><small>不含测试报文</small></td>
            <td>${badge(item.status)}</td>
          </tr>`).join("") || `<tr><td colspan="6" class="empty-cell">暂无合同测试记录</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function renderCallbacks() {
    document.getElementById("national-callback-table").innerHTML = `
      <table>
        <thead><tr><th>订阅</th><th>机构/环境</th><th>端点引用</th><th>事件</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${center.callbackSubscriptions.map((item) => `<tr>
            <td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.id)}</small></td>
            <td>${escapeHtml(item.orgCode)}<small>${escapeHtml(item.environment)}</small></td>
            <td><code>${escapeHtml(item.endpointReference)}</code><small>${escapeHtml(item.signatureAlgorithm)}</small></td>
            <td>${(item.eventTypes || []).map((value) => `<code>${escapeHtml(value)}</code>`).join("<br />")}</td>
            <td>${badge(item.status)}<small>生产投递阻断</small></td>
            <td>${item.status === "active" && (user.role === "commission" || item.orgCode === user.orgCode)
              ? `<button class="ghost-button compact" type="button" data-lifecycle-kind="callbacks" data-id="${escapeHtml(item.id)}" data-action="revoke">撤销</button>`
              : "—"}</td>
          </tr>`).join("") || `<tr><td colspan="6" class="empty-cell">暂无回调订阅</td></tr>`}
        </tbody>
      </table>
    `;
    document.getElementById("national-callback-delivery-table").innerHTML = `
      <table>
        <thead><tr><th>投递任务</th><th>事件/对象</th><th>幂等键</th><th>摘要策略</th><th>状态</th><th>接收回执</th></tr></thead>
        <tbody>
          ${center.callbackDeliveries.map((item) => `<tr>
            <td><strong>${escapeHtml(item.id)}</strong><small>${formatDate(item.preparedAt)}</small></td>
            <td>${escapeHtml(item.eventType)}<small>${escapeHtml(item.subjectReference)}</small></td>
            <td><code>${escapeHtml(item.idempotencyKey.slice(0, 20))}…</code></td>
            <td><code>${escapeHtml(item.eventDigest.slice(0, 16))}…</code><small>不含业务载荷</small></td>
            <td>${badge(item.status)}<small>${escapeHtml(item.receiptCode || "")}</small></td>
            <td>${item.status === "prepared" ? `
              <input data-receipt-digest="${escapeHtml(item.id)}" minlength="64" maxlength="64" placeholder="回执SHA-256摘要" />
              <button class="ghost-button compact" type="button" data-callback-delivery-action data-id="${escapeHtml(item.id)}" data-action="acknowledge">确认回执</button>
            ` : formatDate(item.acknowledgedAt)}</td>
          </tr>`).join("") || `<tr><td colspan="6" class="empty-cell">暂无回调投递任务</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function renderSlaAlerts() {
    document.getElementById("national-sla-alert-table").innerHTML = `
      <table>
        <thead><tr><th>级别</th><th>类别/目标</th><th>告警说明</th><th>实测/阈值</th><th>状态</th><th>检测时间</th></tr></thead>
        <tbody>
          ${center.slaAlerts.map((item) => `<tr>
            <td>${badge(item.severity)}</td>
            <td>${escapeHtml(item.category)}<small>${escapeHtml(item.targetId)}</small></td>
            <td>${escapeHtml(item.message)}</td>
            <td>${escapeHtml(item.value)} / ${escapeHtml(item.threshold)}</td>
            <td>${badge(item.status)}</td>
            <td>${formatDate(item.updatedAt || item.detectedAt)}</td>
          </tr>`).join("") || `<tr><td colspan="6" class="empty-cell">暂无未恢复SLA告警</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function renderQuotaAndUsage() {
    document.getElementById("national-quota-table").innerHTML = `
      <table>
        <thead><tr><th>环境</th><th>配额策略</th><th>分钟上限</th><th>自然日上限</th><th>状态</th></tr></thead>
        <tbody>
          ${center.apiQuotaPolicies.map((item) => `<tr>
            <td>${escapeHtml(item.environment)}</td>
            <td><strong>${escapeHtml(item.id)}</strong></td>
            <td>${escapeHtml(item.minuteLimit)} 次</td>
            <td>${escapeHtml(item.dailyLimit)} 次</td>
            <td>${badge(item.status)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    `;
    document.getElementById("national-api-usage-table").innerHTML = `
      <table>
        <thead><tr><th>调用时间</th><th>机构/密钥</th><th>服务包/合同</th><th>幂等键</th><th>用量</th><th>状态</th></tr></thead>
        <tbody>
          ${center.apiUsageEvents.map((item) => `<tr>
            <td>${formatDate(item.at)}<small>${escapeHtml(item.environment)}</small></td>
            <td>${escapeHtml(item.orgCode)}<small>${escapeHtml(item.credentialId)}</small></td>
            <td>${escapeHtml(item.packageId)}<small>${escapeHtml(item.contractId)}</small></td>
            <td><code>${escapeHtml(item.idempotencyKey)}</code><small>${escapeHtml(item.payloadDigest.slice(0, 16))}…</small></td>
            <td>${escapeHtml(item.minuteUsage)} / 分钟<small>${escapeHtml(item.dailyUsage)} / 日</small></td>
            <td>${badge(item.status)}<small>仅元数据</small></td>
          </tr>`).join("") || `<tr><td colspan="6" class="empty-cell">暂无开发者API调用</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function renderSecurityAlerts() {
    document.getElementById("national-security-alert-table").innerHTML = `
      <table>
        <thead><tr><th>级别</th><th>机构</th><th>凭证对象</th><th>告警说明</th><th>状态</th><th>检测时间</th></tr></thead>
        <tbody>
          ${center.securityAlerts.map((item) => `<tr>
            <td>${badge(item.severity)}</td>
            <td>${escapeHtml(item.orgCode || "国家/节点")}</td>
            <td>${escapeHtml(item.targetType)}<small>${escapeHtml(item.targetId)}</small></td>
            <td>${escapeHtml(item.message)}</td>
            <td>${badge(item.status)}</td>
            <td>${formatDate(item.updatedAt || item.detectedAt)}</td>
          </tr>`).join("") || `<tr><td colspan="6" class="empty-cell">暂无凭证安全告警</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function renderCertifications() {
    document.getElementById("national-certification-table").innerHTML = `
      <table>
        <thead><tr><th>认证报告</th><th>机构/节点</th><th>检查结果</th><th>有效期</th><th>状态</th><th>生产开放</th></tr></thead>
        <tbody>
          ${center.certificationReports.map((item) => {
            const passed = (item.checklist || []).filter((check) => check.passed).length;
            return `<tr>
              <td><strong>${escapeHtml(item.reportCode)}</strong><small>${formatDate(item.issuedAt)}</small></td>
              <td>${escapeHtml(item.orgCode)}<small>${escapeHtml(item.nodeId)}</small></td>
              <td>${escapeHtml(item.score)} 分<small>${passed}/${(item.checklist || []).length}项通过</small></td>
              <td>${formatDate(item.validUntil)}</td>
              <td>${badge(item.status)}</td>
              <td><span class="badge danger">保持阻断</span><small>${(item.productionBlockers || []).length}项外部证据待完成</small></td>
            </tr>`;
          }).join("") || `<tr><td colspan="6" class="empty-cell">尚未出具机构接入认证报告</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function standardActions(item) {
    if (user.role !== "commission") return "";
    const actions = item.status === "compatible"
      ? [["approve", "审批"], ["reject", "驳回"]]
      : item.status === "conflict"
        ? [["reject", "驳回"]]
        : [];
    return actions.map(([action, text]) => `
      <button class="ghost-button compact" type="button" data-lifecycle-kind="standards/extensions" data-id="${escapeHtml(item.id)}" data-action="${action}">${text}</button>
    `).join("");
  }

  function renderStandards() {
    document.getElementById("national-standard-table").innerHTML = `
      <table>
        <thead><tr><th>国家标准</th><th>版本</th><th>兼容策略</th><th>状态</th></tr></thead>
        <tbody>${center.standards.map((item) => `<tr>
          <td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.code)}</small></td>
          <td>${escapeHtml(item.version)}</td>
          <td>${escapeHtml(item.compatibilityPolicy)}</td>
          <td>${badge(item.status)}</td>
        </tr>`).join("")}</tbody>
      </table>
    `;
    document.getElementById("national-extension-table").innerHTML = `
      <table>
        <thead><tr><th>属地扩展</th><th>国家标准/版本</th><th>扩展字段</th><th>校验结果</th><th>操作</th></tr></thead>
        <tbody>
          ${center.standardExtensions.map((item) => `<tr>
            <td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(center.nodes.find((node) => node.id === item.nodeId)?.nodeCode || item.nodeId)} · ${escapeHtml(item.extensionVersion)}</small></td>
            <td>${escapeHtml(item.standardId)}<small>基于 v${escapeHtml(item.basedOnVersion)}</small></td>
            <td>${(item.fields || []).map((field) => `<code>${escapeHtml(field)}</code>`).join("<br />") || "—"}</td>
            <td>${badge(item.status)}<small>${(item.conflictReasons || []).map(escapeHtml).join("；")}</small></td>
            <td><div class="national-row-actions">${standardActions(item)}</div></td>
          </tr>`).join("") || `<tr><td colspan="5" class="empty-cell">暂无属地扩展</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function setSelectOptions(select, rows, valueKey, labelBuilder) {
    if (!select) return;
    const previous = select.value;
    select.innerHTML = rows.map((item) => `<option value="${escapeHtml(item[valueKey])}">${escapeHtml(labelBuilder(item))}</option>`).join("");
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }

  function updateRoutingConsentOptions() {
    const form = document.getElementById("routing-envelope-form");
    const select = form?.querySelector('[name="consentReference"]');
    const route = center?.routingTraces.find((item) => item.id === form?.elements.routeId?.value);
    const contractId = form?.elements.contractId?.value;
    const eligible = route
      ? center.consentAuthorizations.filter((item) => (
        item.status === "active"
        && new Date(item.validFrom).getTime() <= Date.now()
        && new Date(item.validUntil).getTime() > Date.now()
        && item.sourceOrgCode === route.sourceOrgCode
        && (item.targetOrgCodes || []).includes(route.targetOrgCode)
        && (item.packageIds || []).includes(route.packageId)
        && (item.contractIds || []).includes(contractId)
        && item.purpose === route.purpose
        && (user.role === "commission" || item.sourceOrgCode === user.orgCode)
      ))
      : [];
    setSelectOptions(
      select,
      eligible,
      "reference",
      (item) => `${item.sourceOrgCode} → ${(item.targetOrgCodes || []).join("、")}｜${item.purpose}`
    );
  }

  function updateAdapterCertificateOptions() {
    const form = document.getElementById("adapter-form");
    const orgCode = form?.elements.orgCode?.value;
    const environment = form?.elements.environment?.value;
    const institution = center?.institutions.find((item) => item.orgCode === orgCode);
    const certificates = center?.certificates.filter((item) => (
      item.subjectType === "institution"
      && item.subjectId === institution?.id
      && item.environment === environment
      && item.status === "active"
      && new Date(item.expiresAt).getTime() > Date.now()
    )) || [];
    setSelectOptions(
      form?.elements.certificateId,
      certificates,
      "id",
      (item) => `${item.serialNumber}｜有效至${formatDate(item.expiresAt)}`
    );
  }

  function updateContractTestOptions() {
    const form = document.getElementById("contract-test-form");
    const adapter = center?.integrationAdapters.find((item) => item.id === form?.elements.adapterId?.value);
    const contracts = (adapter?.supportedContracts || []).map((id) => ({ id }));
    setSelectOptions(form?.elements.contractId, contracts, "id", (item) => item.id);
  }

  function renderForms() {
    document.querySelectorAll("[data-commission-only]").forEach((item) => {
      item.hidden = user.role !== "commission";
    });
    const activeNodes = center.nodes.filter((item) => item.status === "active" && item.nodeType !== "national");
    setSelectOptions(document.querySelector('#node-health-form [name="nodeId"]'), center.nodes, "id", (item) => `${item.name}（${item.nodeCode}）`);
    setSelectOptions(document.querySelector('#institution-register-form [name="nodeId"]'), activeNodes, "id", (item) => `${item.name}（${item.nodeCode}）`);
    setSelectOptions(document.querySelector('#subscription-form [name="orgCode"]'), center.institutions, "orgCode", (item) => `${item.name}（${item.orgCode}）`);
    setSelectOptions(document.querySelector('#route-plan-form [name="sourceOrgCode"]'), center.institutions, "orgCode", (item) => `${item.name}（${item.orgCode}）`);
    setSelectOptions(document.querySelector('#subscription-form [name="packageId"]'), center.servicePackages, "id", (item) => item.name);
    setSelectOptions(document.querySelector('#route-plan-form [name="packageId"]'), center.servicePackages, "id", (item) => item.name);
    const certificateSubjects = [
      ...center.nodes.filter((item) => item.status === "active").map((item) => ({
        ref: `node:${item.id}`,
        name: `节点｜${item.name}（${item.nodeCode}）`
      })),
      ...center.institutions.filter((item) => item.status === "active").map((item) => ({
        ref: `institution:${item.id}`,
        name: `机构｜${item.name}（${item.orgCode}）`
      }))
    ];
    setSelectOptions(document.querySelector('#certificate-form [name="subjectRef"]'), certificateSubjects, "ref", (item) => item.name);
    setSelectOptions(
      document.querySelector('#credential-form [name="orgCode"]'),
      center.institutions.filter((item) => item.status === "active"),
      "orgCode",
      (item) => `${item.name}（${item.orgCode}）`
    );
    setSelectOptions(
      document.querySelector('#routing-envelope-form [name="routeId"]'),
      center.routingTraces.filter((item) => (
        ["ready", "degraded", "failover"].includes(item.status)
        && (user.role === "commission" || item.sourceOrgCode === user.orgCode)
      )),
      "id",
      (item) => `${item.sourceOrgCode} → ${item.targetOrgCode}｜${item.packageId}｜${label(item.status)}`
    );
    setSelectOptions(
      document.querySelector('#consent-form [name="sourceOrgCode"]'),
      center.institutions.filter((item) => item.status === "active"),
      "orgCode",
      (item) => `${item.name}（${item.orgCode}）`
    );
    setSelectOptions(
      document.querySelector('#adapter-form [name="orgCode"]'),
      center.institutions.filter((item) => item.status === "active"),
      "orgCode",
      (item) => `${item.name}（${item.orgCode}）`
    );
    setSelectOptions(
      document.querySelector('#callback-form [name="orgCode"]'),
      center.institutions.filter((item) => item.status === "active"),
      "orgCode",
      (item) => `${item.name}（${item.orgCode}）`
    );
    setSelectOptions(
      document.querySelector('#contract-test-form [name="adapterId"]'),
      center.integrationAdapters.filter((item) => item.status !== "suspended"),
      "id",
      (item) => `${item.orgCode}｜${item.systemType}｜${item.name}`
    );
    updateAdapterCertificateOptions();
    updateContractTestOptions();
    updateRoutingConsentOptions();
    const consentExpiry = document.querySelector('#consent-form [name="validUntil"]');
    if (consentExpiry && !consentExpiry.value) {
      const defaultExpiry = new Date(Date.now() + 30 * 86_400_000);
      defaultExpiry.setMinutes(defaultExpiry.getMinutes() - defaultExpiry.getTimezoneOffset());
      consentExpiry.value = defaultExpiry.toISOString().slice(0, 16);
    }
    setSelectOptions(
      document.querySelector('#standard-extension-form [name="nodeId"]'),
      activeNodes,
      "id",
      (item) => `${item.name}（${item.nodeCode}）`
    );
    setSelectOptions(
      document.querySelector('#standard-extension-form [name="standardId"]'),
      center.standards.filter((item) => item.status === "active"),
      "id",
      (item) => `${item.name} v${item.version}`
    );
    const activeSubscribedPackageIds = new Set(
      center.subscriptions.filter((item) => item.status === "active").map((item) => item.packageId)
    );
    const sandboxPackages = center.servicePackages.filter((item) => activeSubscribedPackageIds.has(item.id));
    setSelectOptions(
      document.querySelector('#sandbox-invoke-form [name="packageId"]'),
      sandboxPackages.length ? sandboxPackages : center.servicePackages,
      "id",
      (item) => `${item.name}（${item.id}）`
    );
    setSelectOptions(
      document.querySelector('#certification-report-form [name="orgCode"]'),
      center.institutions.filter((item) => item.status === "active"),
      "orgCode",
      (item) => `${item.name}（${item.orgCode}）`
    );
    const routePackage = document.querySelector('#route-plan-form [name="packageId"]');
    if (routePackage && [...routePackage.options].some((item) => item.value === "pkg-lab-imaging")) routePackage.value = "pkg-lab-imaging";
  }

  function render() {
    renderMetrics();
    renderPackages();
    renderNodes();
    renderInstitutions();
    renderSubscriptions();
    renderRoutes();
    renderCertificates();
    renderCredentials();
    renderEnvelopes();
    renderConsents();
    renderSdkManifest();
    renderAdapters();
    renderContractTests();
    renderCallbacks();
    renderSlaAlerts();
    renderQuotaAndUsage();
    renderSecurityAlerts();
    renderCertifications();
    renderStandards();
    renderForms();
  }

  async function loadCenter(message = "") {
    [center, sdkManifest] = await Promise.all([
      request(""),
      request("/sdk/manifest")
    ]);
    render();
    if (message) showMessage(message, "success");
  }

  function formPayload(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function showCredentialSecret(secret) {
    if (!secret) return;
    const output = document.getElementById("credential-secret-output");
    output.hidden = false;
    output.querySelector("code").textContent = secret;
  }

  function bindForm(id, endpoint, transform = (payload) => payload, onSuccess = null) {
    const form = document.getElementById(id);
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const payload = transform(formPayload(form));
        const result = await request(endpoint, { method: "POST", body: JSON.stringify(payload) });
        form.reset();
        await loadCenter("操作已提交并写入接入审计。");
        if (onSuccess) onSuccess(result);
      } catch (error) {
        showMessage(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  function bindSandboxInvoke() {
    const form = document.getElementById("sandbox-invoke-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const output = document.getElementById("sandbox-invoke-output");
      button.disabled = true;
      try {
        const payload = formPayload(form);
        const developerKey = payload.developerKey;
        delete payload.developerKey;
        const result = await request("/sandbox/invoke", {
          method: "POST",
          headers: { "X-National-Access-Key": developerKey },
          body: JSON.stringify(payload)
        });
        form.reset();
        await loadCenter(result.duplicate ? "幂等重放成功，未重复计量。" : "沙箱调用已受理并完成配额计量。");
        output.hidden = false;
        output.textContent = `回执 ${result.acknowledgement.acknowledgementId}；分钟用量 ${result.usage.minuteUsage}；当日用量 ${result.usage.dailyUsage}；${result.duplicate ? "重复请求" : "首次受理"}`;
      } catch (error) {
        output.hidden = true;
        showMessage(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  function bindContractTestForm() {
    const form = document.getElementById("contract-test-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const payload = formPayload(form);
        const adapterId = payload.adapterId;
        delete payload.adapterId;
        payload.results = Object.fromEntries([
          "schemaValid",
          "signatureVerified",
          "idempotencyVerified",
          "retryVerified",
          "auditVerified",
          "minimizationVerified"
        ].map((check) => [check, payload[check] === "true"]));
        Object.keys(payload.results).forEach((check) => delete payload[check]);
        const result = await request(`/adapters/${encodeURIComponent(adapterId)}/contract-tests`, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        form.reset();
        await loadCenter(
          result.contractTest.status === "passed"
            ? "合同一致性测试全部通过，已生成证据记录和回调任务。"
            : "合同一致性测试未全部通过，请按失败检查项整改。"
        );
      } catch (error) {
        showMessage(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  function bindCallbackDeliveryActions() {
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-callback-delivery-action]");
      if (!button) return;
      const receiptInput = document.querySelector(`[data-receipt-digest="${CSS.escape(button.dataset.id)}"]`);
      const receiptDigest = receiptInput?.value.trim() || "";
      if (!/^[a-f0-9]{64}$/i.test(receiptDigest)) {
        showMessage("请输入64位十六进制回执SHA-256摘要。", "error");
        receiptInput?.focus();
        return;
      }
      button.disabled = true;
      try {
        await request(`/callback-deliveries/${encodeURIComponent(button.dataset.id)}/actions`, {
          method: "POST",
          body: JSON.stringify({
            action: button.dataset.action,
            receiptDigest
          })
        });
        await loadCenter("回调接收回执已登记并写入审计。");
      } catch (error) {
        showMessage(error.message, "error");
        button.disabled = false;
      }
    });
  }

  function bindLifecycleActions() {
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-lifecycle-kind]");
      if (!button) return;
      button.disabled = true;
      try {
        const result = await request(`/${button.dataset.lifecycleKind}/${encodeURIComponent(button.dataset.id)}/actions`, {
          method: "POST",
          body: JSON.stringify({ action: button.dataset.action })
        });
        await loadCenter(`状态操作“${button.textContent.trim()}”已完成。`);
        showCredentialSecret(result.secret);
      } catch (error) {
        showMessage(error.message, "error");
        button.disabled = false;
      }
    });
  }

  async function initialize() {
    auth.renderSessionBar();
    bindForm("node-register-form", "/nodes", (payload) => ({
      ...payload,
      capabilities: String(payload.capabilities || "").split(",").map((item) => item.trim()).filter(Boolean)
    }));
    bindForm("institution-register-form", "/institutions");
    bindForm("subscription-form", "/subscriptions");
    bindForm("node-health-form", "/node-health", (payload) => ({ ...payload, latencyMs: Number(payload.latencyMs) }));
    bindForm("route-plan-form", "/routes/plan");
    bindForm("certificate-form", "/certificates", (payload) => {
      const [subjectType, subjectId] = String(payload.subjectRef || "").split(":");
      return {
        subjectType,
        subjectId,
        environment: payload.environment,
        expiresAt: payload.expiresAt || undefined,
        publicKeyFingerprint: payload.publicKeyFingerprint
      };
    });
    bindForm(
      "credential-form",
      "/credentials",
      (payload) => ({
        ...payload,
        scopes: String(payload.scopes || "").split(",").map((item) => item.trim()).filter(Boolean)
      }),
      (result) => showCredentialSecret(result.secret)
    );
    bindForm("consent-form", "/consents", (payload) => ({
      ...payload,
      targetOrgCodes: String(payload.targetOrgCodes || "").split(",").map((item) => item.trim()).filter(Boolean),
      packageIds: String(payload.packageIds || "").split(",").map((item) => item.trim()).filter(Boolean),
      contractIds: String(payload.contractIds || "").split(",").map((item) => item.trim()).filter(Boolean),
      validUntil: new Date(payload.validUntil).toISOString()
    }));
    bindForm("adapter-form", "/adapters", (payload) => ({
      ...payload,
      supportedContracts: String(payload.supportedContracts || "").split(",").map((item) => item.trim()).filter(Boolean)
    }));
    bindForm("callback-form", "/callbacks", (payload) => ({
      ...payload,
      eventTypes: String(payload.eventTypes || "").split(",").map((item) => item.trim()).filter(Boolean)
    }));
    bindForm("routing-envelope-form", "/routes/envelopes");
    document.querySelector('#adapter-form [name="orgCode"]')?.addEventListener("change", updateAdapterCertificateOptions);
    document.querySelector('#adapter-form [name="environment"]')?.addEventListener("change", updateAdapterCertificateOptions);
    document.querySelector('#contract-test-form [name="adapterId"]')?.addEventListener("change", updateContractTestOptions);
    document.querySelector('#routing-envelope-form [name="routeId"]')?.addEventListener("change", updateRoutingConsentOptions);
    document.querySelector('#routing-envelope-form [name="contractId"]')?.addEventListener("change", updateRoutingConsentOptions);
    bindForm("operations-evaluate-form", "/operations/evaluate");
    bindForm("security-evaluate-form", "/security/evaluate");
    bindForm("certification-report-form", "/certification-reports");
    bindForm("standard-extension-form", "/standards/extensions", (payload) => ({
      ...payload,
      fields: String(payload.fields || "").split(",").map((item) => item.trim()).filter(Boolean)
    }));
    bindSandboxInvoke();
    bindContractTestForm();
    bindCallbackDeliveryActions();
    bindLifecycleActions();
    try {
      await loadCenter();
    } catch (error) {
      showMessage(error.message, "error");
    }
  }

  initialize();
})();
