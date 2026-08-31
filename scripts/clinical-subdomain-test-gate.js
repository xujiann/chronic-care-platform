#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Linter } = require("eslint");
const {
  EXPECTED_SUBDOMAINS,
  loadClinicalSubdomainRegistry,
  validateClinicalSubdomainRegistry
} = require("../src/clinical-specialties/subdomain-governance");

const ROOT = path.resolve(__dirname, "..");
const RUNNER = "scripts/clinical-subdomain-test-gate.js";
const TEST_PREFIXES = Object.freeze({
  emergency: "emergency-",
  blood: "blood-",
  imaging: "imaging-",
  "physical-examination": "physical-examination-",
  "quality-safety": "quality-safety-"
});

function normalizeRepoPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function isInside(parent, target) {
  const relative = path.relative(parent, target);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function duplicateValues(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function walkAst(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  Object.entries(node).forEach(([key, value]) => {
    if (key === "start" || key === "end" || key === "loc" || key === "parent") return;
    if (Array.isArray(value)) value.forEach((child) => walkAst(child, visit));
    else if (value && typeof value.type === "string") walkAst(value, visit);
  });
}

function staticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((item) => item.value.cooked).join("");
  }
  return null;
}

function routeAnchor(value) {
  if (typeof value !== "string") return null;
  if (value.startsWith("/api/")) return value.split(/[?#]/, 1)[0];
  try {
    const url = new URL(value);
    return url.pathname.startsWith("/api/") ? url.pathname : null;
  } catch {
    return null;
  }
}

function parseJavaScript(source, sourceType) {
  let ast = null;
  const linter = new Linter({ configType: "eslintrc" });
  linter.defineRule("capture-clinical-test-ast", {
    create() {
      return { Program(node) { ast = node; } };
    }
  });
  const messages = linter.verify(source, {
    parserOptions: { ecmaVersion: "latest", sourceType },
    rules: { "capture-clinical-test-ast": "error" }
  });
  return { ast, error: messages.find((message) => message.fatal) };
}

function analyzeTestSource(source, file, errors, owner) {
  let parsed = parseJavaScript(source, "script");
  if (!parsed.ast) parsed = parseJavaScript(source, "module");
  if (!parsed.ast) {
    errors.push(`${owner} test file cannot be parsed: ${file}: ${parsed.error?.message || "unknown syntax error"}`);
    return { moduleSpecifiers: [], routeAnchors: [], executableTests: [] };
  }
  const { ast } = parsed;

  const moduleSpecifiers = [];
  const routeAnchors = new Set();
  const executableTests = [];
  const staticBindings = new Map();
  ast.body.forEach((statement) => {
    if (statement.type === "ImportDeclaration") {
      const value = staticString(statement.source);
      if (value) moduleSpecifiers.push(value);
      return;
    }
    if (statement.type !== "VariableDeclaration") return;
    statement.declarations.forEach((declaration) => {
      const call = declaration.init;
      if (call?.type !== "CallExpression"
        || call.callee?.type !== "Identifier"
        || call.callee.name !== "require") return;
      const value = staticString(call.arguments[0]);
      if (value) moduleSpecifiers.push(value);
    });
  });
  walkAst(ast, (node) => {
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") {
      const value = staticString(node.init);
      if (value !== null) staticBindings.set(node.id.name, value);
    }
    if (node.type !== "CallExpression"
      || node.callee?.type !== "Identifier"
      || node.callee.name !== "test") return;
    const title = staticString(node.arguments[0]);
    const body = node.arguments.find((argument, index) => index > 0
      && ["ArrowFunctionExpression", "FunctionExpression"].includes(argument?.type));
    if (!title?.trim() || !body) return;
    executableTests.push(title);
    walkAst(body.body, (child) => {
      if (child.type === "NewExpression"
        && child.callee?.type === "Identifier"
        && child.callee.name === "URL") {
        const anchor = routeAnchor(staticString(child.arguments[0]));
        if (anchor) routeAnchors.add(anchor);
      }
      if (child.type === "CallExpression"
        && child.callee?.type === "MemberExpression"
        && child.callee.object?.type === "Identifier"
        && child.callee.object.name === "assert") {
        child.arguments.forEach((argument) => {
          walkAst(argument, (assertionNode) => {
            const value = assertionNode.type === "Identifier"
              ? staticBindings.get(assertionNode.name)
              : staticString(assertionNode);
            const anchor = routeAnchor(value);
            if (anchor) routeAnchors.add(anchor);
          });
        });
      }
    });
  });
  if (!moduleSpecifiers.includes("node:test") || executableTests.length === 0) {
    errors.push(`${owner} test file must declare executable node:test cases: ${file}`);
  }
  return {
    moduleSpecifiers: [...new Set(moduleSpecifiers)],
    routeAnchors: [...routeAnchors],
    executableTests
  };
}

function analyzeTestFiles(root, files, errors, owner, sourceOverrides = {}) {
  const modulePaths = new Set();
  const routeAnchors = new Set();
  let executableTestCount = 0;
  files.forEach((file) => {
    const absolute = path.resolve(root, file);
    const testRoot = path.resolve(root, "test");
    if (!isInside(testRoot, absolute) || !file.endsWith(".test.js")) {
      errors.push(`${owner} test path must stay under test/*.test.js: ${file}`);
      return;
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      errors.push(`${owner} test file does not exist: ${file}`);
      return;
    }
    const source = Object.hasOwn(sourceOverrides, file)
      ? sourceOverrides[file]
      : fs.readFileSync(absolute, "utf8");
    const evidence = analyzeTestSource(source, file, errors, owner);
    executableTestCount += evidence.executableTests.length;
    evidence.routeAnchors.forEach((anchor) => routeAnchors.add(anchor));
    evidence.moduleSpecifiers
      .filter((specifier) => specifier.startsWith("."))
      .forEach((specifier) => {
        const resolved = path.resolve(path.dirname(absolute), specifier);
        modulePaths.add(normalizeRepoPath(path.relative(root, resolved)));
      });
  });
  return Object.freeze({
    executableTestCount,
    modulePaths: Object.freeze([...modulePaths]),
    routeAnchors: Object.freeze([...routeAnchors])
  });
}

function parseGovernanceCiWorkflow(source, expectedRun) {
  const rawLines = String(source || "").replaceAll("\t", "\u0000").split(/\r?\n/);
  let structureValid = !rawLines.some((line) => line.includes("\u0000"));
  const lines = rawLines
    .map((raw, index) => ({ raw, index, indent: raw.match(/^ */)[0].length, text: raw.trim() }))
    .filter((line) => line.text && !line.text.startsWith("#"));
  if (lines.some((line) => line.indent % 2 !== 0)) structureValid = false;

  const jobsIndexes = lines.flatMap((line, index) => line.indent === 0 && line.text === "jobs:" ? [index] : []);
  if (jobsIndexes.length !== 1) structureValid = false;
  const jobsIndex = jobsIndexes[0] ?? -1;
  const nextTopLevelOffset = lines.slice(jobsIndex + 1).findIndex((line) => line.indent === 0);
  const jobsEnd = nextTopLevelOffset < 0 ? lines.length : jobsIndex + 1 + nextTopLevelOffset;
  const jobHeaders = lines.flatMap((line, index) => {
    if (index <= jobsIndex || index >= jobsEnd || line.indent !== 2) return [];
    const match = line.text.match(/^([A-Za-z0-9_-]+):$/);
    return match ? [{ id: match[1], index }] : [];
  });
  const governanceHeaders = jobHeaders.filter((header) => header.id === "governance-api");
  const jobFound = governanceHeaders.length === 1;
  if (governanceHeaders.length > 1) structureValid = false;
  if (!jobFound) {
    return { structureValid, jobFound, jobUnconditional: false, stepFound: false, stepUnconditional: false, stepBlocking: false };
  }

  const jobStart = governanceHeaders[0].index;
  const nextJob = jobHeaders.find((header) => header.index > jobStart);
  const jobEnd = nextJob?.index ?? lines.length;
  const jobLines = lines.slice(jobStart + 1, jobEnd);
  const directJobLines = jobLines.filter((line) => line.indent === 4);
  if (jobLines.some((line) => line.indent < 4)) structureValid = false;
  const jobUnconditional = !directJobLines.some((line) => /^if\s*:/.test(line.text));
  const stepsHeaders = directJobLines.filter((line) => line.text === "steps:");
  if (stepsHeaders.length !== 1) structureValid = false;
  if (stepsHeaders.length !== 1) {
    return { structureValid, jobFound, jobUnconditional, stepFound: false, stepUnconditional: false, stepBlocking: false };
  }

  const stepsStart = jobLines.indexOf(stepsHeaders[0]);
  const stepRegion = jobLines.slice(stepsStart + 1).filter((line) => line.indent > 4);
  const stepStarts = stepRegion.flatMap((line, index) => line.indent === 6 && line.text.startsWith("- ") ? [index] : []);
  if (stepRegion.some((line) => line.indent === 6 && !line.text.startsWith("- "))) structureValid = false;
  const steps = stepStarts.map((start, index) => {
    const end = stepStarts[index + 1] ?? stepRegion.length;
    return stepRegion.slice(start, end);
  });
  const matchingSteps = steps.filter((step) => {
    let runPropertyIndex = -1;
    let runValue = "";
    step.forEach((line, index) => {
      const text = index === 0 ? line.text.slice(2).trim() : line.text;
      const propertyIndent = index === 0 ? 6 : 8;
      if (line.indent !== propertyIndent || !text.startsWith("run:")) return;
      runPropertyIndex = index;
      runValue = text.slice(4).trim();
    });
    if (runPropertyIndex < 0) return false;
    if (runValue === expectedRun) return true;
    if (!/^[|>][-+]?\s*$/.test(runValue)) return false;
    const runIndent = step[runPropertyIndex].indent;
    return step.slice(runPropertyIndex + 1).some((line) => line.indent > runIndent && line.text === expectedRun);
  });
  const stepFound = matchingSteps.length === 1;
  const activeStep = matchingSteps[0] || [];
  const stepPropertyTexts = activeStep.map((line, index) => index === 0 ? line.text.slice(2).trim() : line.text);
  const stepUnconditional = stepFound && !stepPropertyTexts.some((text) => /^if\s*:/.test(text));
  const stepBlocking = stepFound && !stepPropertyTexts.some((text) => /^continue-on-error\s*:\s*true\s*$/.test(text));
  return { structureValid, jobFound, jobUnconditional, stepFound, stepUnconditional, stepBlocking };
}

function detectCiWiring(root, governance, options = {}) {
  const packageFile = path.join(root, "package.json");
  const workflowFile = path.join(root, ".github", "workflows", "ci.yml");
  const packageJson = options.packageJson
    || (fs.existsSync(packageFile) ? JSON.parse(fs.readFileSync(packageFile, "utf8")) : {});
  const workflowSource = options.workflowSource
    ?? (fs.existsSync(workflowFile) ? fs.readFileSync(workflowFile, "utf8") : "");
  const scriptName = governance.ciScript;
  const scriptWired = typeof scriptName === "string"
    && packageJson.scripts?.[scriptName] === governance.allEntrypoint;
  const expectedRun = `npm run ${scriptName}`;
  const parsed = parseGovernanceCiWorkflow(workflowSource, expectedRun);
  const workflowWired = parsed.structureValid
    && parsed.jobUnconditional
    && parsed.stepUnconditional
    && parsed.stepBlocking;
  return Object.freeze({
    scriptName,
    scriptWired,
    ...parsed,
    workflowWired,
    wired: scriptWired && workflowWired
  });
}

function validateClinicalTestGates(root = ROOT, registry = loadClinicalSubdomainRegistry(root), options = {}) {
  const errors = [...validateClinicalSubdomainRegistry(root, registry).issues];
  const governance = registry.testGovernance || {};
  const subdomains = Array.isArray(registry.subdomains) ? registry.subdomains : [];
  const ids = subdomains.map((item) => item.id);
  const allTestFiles = [];

  if (governance.schemaVersion !== "1.0.0") errors.push("clinical test governance schemaVersion must be 1.0.0");
  if (governance.runner !== RUNNER) errors.push(`clinical test governance runner must be ${RUNNER}`);
  if (governance.allEntrypoint !== `node ${RUNNER} --all`) {
    errors.push("clinical all-test entrypoint must use the governed runner");
  }
  if (governance.ciScript !== "clinical-subdomains:test") {
    errors.push("clinical CI script name must be clinical-subdomains:test");
  }
  if (governance.productionReady !== false) errors.push("clinical test governance must remain production fail closed");
  if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_SUBDOMAINS)) {
    errors.push(`clinical test gates must cover ${EXPECTED_SUBDOMAINS.join(",")}`);
  }

  const sharedTests = (governance.sharedGovernanceTests || []).map(normalizeRepoPath);
  if (sharedTests.length === 0) errors.push("clinical test governance must declare shared governance tests");
  if (duplicateValues(sharedTests).length) errors.push("clinical shared governance tests must be unique");
  analyzeTestFiles(root, sharedTests, errors, "shared-governance", options.testSourceOverrides);

  subdomains.forEach((subdomain) => {
    const gate = subdomain.testGate || {};
    const expectedEntrypoint = `node ${RUNNER} --subdomain ${subdomain.id}`;
    const testFiles = (gate.testFiles || []).map(normalizeRepoPath);
    allTestFiles.push(...testFiles);

    if (gate.entrypoint !== expectedEntrypoint) {
      errors.push(`${subdomain.id} test entrypoint must be ${expectedEntrypoint}`);
    }
    if (gate.status !== "local-independent-test-ready") {
      errors.push(`${subdomain.id} test gate must be local-independent-test-ready`);
    }
    if (gate.productionReady !== false) {
      errors.push(`${subdomain.id} test gate must remain production fail closed`);
    }
    if (testFiles.length === 0) errors.push(`${subdomain.id} test gate must not be empty`);
    const duplicates = duplicateValues(testFiles);
    if (duplicates.length) errors.push(`${subdomain.id} test gate contains duplicates: ${duplicates.join(", ")}`);

    const prefix = `test/${TEST_PREFIXES[subdomain.id] || `${subdomain.id}-`}`;
    testFiles.filter((file) => !file.startsWith(prefix)).forEach((file) => {
      errors.push(`${subdomain.id} test gate includes a foreign test: ${file}`);
    });
    const evidence = analyzeTestFiles(root, testFiles, errors, subdomain.id, options.testSourceOverrides);
    const targetImport = `src/clinical-specialties/${subdomain.id}/`;
    if (!evidence.modulePaths.some((modulePath) => modulePath.startsWith(targetImport))) {
      errors.push(`${subdomain.id} test gate does not exercise its target source root`);
    }
    if (!evidence.modulePaths.some((modulePath) => modulePath.startsWith("src/http/routes/clinical-specialties/"))) {
      errors.push(`${subdomain.id} test gate does not exercise its HTTP facade`);
    }
    (subdomain.implementedUseCases || []).forEach((useCase) => {
      const routePath = String(useCase.route || "").split(" ")[1];
      if (routePath && !evidence.routeAnchors.includes(routePath)) {
        errors.push(`${subdomain.id} test gate does not bind implemented route ${useCase.route}`);
      }
    });
  });

  const crossGateDuplicates = duplicateValues(allTestFiles);
  if (crossGateDuplicates.length) {
    errors.push(`clinical test files must have one subdomain owner: ${crossGateDuplicates.join(", ")}`);
  }

  const exitCriteria = new Map(
    (registry.independentDevelopmentExitCriteria || []).map((criterion) => [criterion.id, criterion.status])
  );
  if (exitCriteria.get("independent-domain-tests") !== "met") {
    errors.push("independent-domain-tests must be met when all five governed test gates exist");
  }
  const ci = detectCiWiring(root, governance, options);
  const expectedCiStatus = ci.wired ? "met" : "partial";
  if (exitCriteria.get("independent-ci-gates") !== expectedCiStatus) {
    errors.push(`independent-ci-gates must be ${expectedCiStatus} for the current package and CI wiring`);
  }

  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    subdomainCount: subdomains.length,
    subdomainTestFileCount: allTestFiles.length,
    sharedTestFileCount: sharedTests.length,
    ci,
    productionReady: false,
    independentDeploymentAuthorized: false
  });
}

function testFilesFor(registry, subdomain) {
  const shared = registry.testGovernance.sharedGovernanceTests.map(normalizeRepoPath);
  if (subdomain === "all") {
    return [...shared, ...registry.subdomains.flatMap((item) => item.testGate.testFiles.map(normalizeRepoPath))];
  }
  const owner = registry.subdomains.find((item) => item.id === subdomain);
  if (!owner) throw new Error(`unknown clinical subdomain: ${subdomain}`);
  return [...shared, ...owner.testGate.testFiles.map(normalizeRepoPath)];
}

function runClinicalTestGate(subdomain, options = {}) {
  const root = options.root || ROOT;
  const registry = options.registry || loadClinicalSubdomainRegistry(root);
  const validation = validateClinicalTestGates(root, registry);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  const files = testFilesFor(registry, subdomain);
  if (options.listOnly) return Object.freeze({ ok: true, subdomain, files: Object.freeze(files) });

  const spawn = options.spawnSync || spawnSync;
  const result = spawn(process.execPath, ["--test", "--test-concurrency=1", ...files], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true
  });
  return Object.freeze({
    ok: result.status === 0,
    subdomain,
    files: Object.freeze(files),
    status: result.status
  });
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === "--check") return { mode: "check" };
  if (argv.length === 1 && argv[0] === "--all") return { mode: "run", subdomain: "all" };
  if (argv.length === 2 && argv[0] === "--subdomain") return { mode: "run", subdomain: argv[1] };
  if (argv.length === 2 && argv[0] === "--list") return { mode: "list", subdomain: argv[1] };
  throw new Error("usage: clinical-subdomain-test-gate.js --check | --all | --subdomain <id> | --list <id|all>");
}

if (require.main === module) {
  try {
    const command = parseArgs(process.argv.slice(2));
    if (command.mode === "check") {
      const report = validateClinicalTestGates(ROOT);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!report.ok) process.exitCode = 1;
    } else {
      const result = runClinicalTestGate(command.subdomain, { listOnly: command.mode === "list" });
      if (command.mode === "list") process.stdout.write(`${result.files.join("\n")}\n`);
      if (!result.ok) process.exitCode = result.status || 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  RUNNER,
  analyzeTestSource,
  detectCiWiring,
  parseArgs,
  runClinicalTestGate,
  testFilesFor,
  validateClinicalTestGates
};
