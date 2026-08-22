# 浏览器响应头部署合同

生产动态服务由 `src/http/browser-security-policy.js` 根据根目录 `browser-security-policy.json` 生成响应头；反向代理不得删除或放宽这些头。HSTS 只在生产运行时生成，真实 TLS 终止层必须验证最终客户端响应仍包含它。

静态构建会把同一策略文件复制到发布制品，并在构建 manifest 中标记 `externalHeaderApplicationRequired=true`。这只是配置合同：当前仓库的 Pages 工作流没有提交真实响应头抓取证据，因此静态站不能据此获得生产安全结论。生产静态入口必须由可设置响应头的托管/CDN 层应用等价策略，并由独立验证记录最终响应。

最低现场检查：

1. HTML、JavaScript、CSS、JSON、404 和重定向后的最终响应均核对 `nosniff`、frame、referrer、permissions 与 CSP。
2. HTTPS 生产域核对 HSTS；不要在未知子域影响范围时擅自加入 `preload`。
3. 显式发布图 P0/P1 静态风险已归零；动态 CSSOM、全角色浏览器和真实托管验证完成前严格 CSP 仍仅 Report-Only，兼容 CSP 中的 `unsafe-inline` 是阻断项，不是豁免证明。
4. 不得添加 `unsafe-eval`、`*` 脚本源、任意 frame 或外部报告接收端，除非另有 Accepted ADR、数据分类和安全评审。
5. 现场抓取、浏览器报告、渗透测试和整改证据保存在受控系统；仓库只登记摘要/引用，不保存凭据、Cookie、令牌或患者数据。

回滚应恢复上一份已验证策略和静态制品，不能删除安全头或放宽清单。任何静态托管无法应用合同的情况保持 `STATIC_HOST_RESPONSE_HEADERS_REQUIRE_EXTERNAL_ENFORCEMENT` 和生产 NO-GO。
