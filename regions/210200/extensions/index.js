"use strict";

module.exports = function registerDalianExtensions(registry) {
  registry.register({
    kind: "adapter",
    id: "regional-health-exchange",
    version: "0.1.0",
    ownedDomain: "integration",
    permissions: ["integration:regional-exchange"],
    dataCollections: ["integration-metadata"],
    provide(context) {
      return {
        profile: context.configs["adapter-profiles"].profiles[0],
        productionEnabled: false
      };
    }
  });
  registry.register({
    kind: "policy",
    id: "regional-governance-policy",
    version: "0.1.0",
    ownedDomain: "platform-governance",
    permissions: ["governance:regional-policy-read"],
    dataCollections: ["policy-rules"],
    provide(context) {
      return { policies: context.configs.policies.policies };
    }
  });
  registry.register({
    kind: "dictionary",
    id: "regional-administrative-dictionary",
    version: "0.1.0",
    ownedDomain: "state-data",
    permissions: ["state-data:regional-dictionary-read"],
    dataCollections: ["administrative-divisions", "dictionaries"],
    provide(context) {
      return {
        division: context.configs["administrative-divisions"].root,
        namespaces: context.configs.dictionaries.namespaces
      };
    }
  });
  registry.register({
    kind: "ui",
    id: "regional-branding",
    version: "0.1.0",
    ownedDomain: "shared",
    permissions: ["shared:regional-ui-read"],
    dataCollections: ["ui-presentation"],
    provide(context) {
      return { theme: context.configs["ui-theme"] };
    }
  });
  registry.register({
    kind: "workflow",
    id: "regional-site-acceptance",
    version: "0.1.0",
    ownedDomain: "platform-governance",
    permissions: ["governance:regional-acceptance-read"],
    dataCollections: ["workflow-definitions"],
    provide() {
      return {
        decisionDefault: "NO-GO",
        requiredEvidence: [
          "joint-test",
          "security-assessment",
          "monitoring",
          "disaster-recovery",
          "signed-site-acceptance"
        ]
      };
    }
  });
};
