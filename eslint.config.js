module.exports = [
  {
    ignores: [
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "release/**",
      "output/**",
      "tmp/**",
      ".tmp*/**"
    ]
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs"
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error"
    },
    rules: {
      "no-dupe-args": "error",
      "no-dupe-class-members": "error",
      "no-dupe-else-if": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "valid-typeof": "error"
    }
  }
];
