import { definePipeline, env, job, sh, task, trigger } from "@async/pipeline";

const packageInputs = [
  "src/**/*.js",
  "src/**/*.d.ts",
  "tests/**/*.test.js",
  "scripts/**/*.js",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "AGENTS.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml"
];

const pipelineInputs = [
  "pipeline.ts",
  "package.json",
  ".github/workflows/async-pipeline.yml",
  ".locks/pipeline/github-workflow.lock.json",
  ".locks/pipeline/tasks.lock.json"
];

export default definePipeline({
  name: "flow",
  cache: "file:local",
  triggers: {
    pr: trigger.github({ events: ["pull_request"] }),
    main: trigger.github({ events: ["push"], branches: ["main"] }),
    release: trigger.github({ events: ["release"], types: ["published"] }),
    manual: trigger.manual()
  },
  sync: {
    github: {
      nodeVersion: 24,
      cache: false,
      dependencyCache: false,
      packagePreviews: true
    },
    tasks: {
      prefix: "pipeline",
      runners: ["package"],
      targets: [{ package: "@async/flow" }],
      jobs: ["publish", "release-doctor", "snapshot", "verify"],
      tasks: ["github.check", "pack", "sync.check", "test", "typecheck"],
      scripts: {
        "github:check": "github check",
        "github:generate": "github generate",
        publish: "run publish",
        "publish:github:main": "publish github main --package .",
        "publish:github:pr": "publish github pr --package .",
        "publish:github:release": "publish github release --package .",
        "publish:npm": "publish npm --package .",
        "release:doctor": "release doctor --package .",
        "release:ensure": "release ensure --package .",
        "release-doctor": "run release-doctor",
        snapshot: "run snapshot",
        "sync:check": "sync check",
        "sync:generate": "sync generate",
        verify: "run verify",
        "verify:force": "run verify --force"
      }
    }
  },
  tasks: {
    test: task({
      description: "Run the Flow test suite.",
      inputs: packageInputs,
      cache: false,
      run: sh`node --test tests/*.test.js`
    }),
    typecheck: task({
      description: "Validate Flow source syntax and exports.",
      inputs: packageInputs,
      cache: false,
      run: sh`node scripts/typecheck.js`
    }),
    "sync.check": task({
      description: "Validate generated package scripts and task locks from pipeline.ts.",
      inputs: pipelineInputs,
      cache: false,
      run: sh`pnpm async-pipeline sync check`
    }),
    "github.check": task({
      description: "Validate generated GitHub Actions workflow and lock state from pipeline.ts.",
      inputs: pipelineInputs,
      cache: false,
      run: sh`pnpm async-pipeline github check`
    }),
    pack: task({
      description: "Verify the public npm package contents without publishing.",
      dependsOn: ["test", "typecheck", "sync.check", "github.check"],
      inputs: [...packageInputs, ...pipelineInputs],
      cache: false,
      run: sh`pnpm run pack:check`
    }),
    snapshot: task({
      description: "Publish main snapshots to GitHub Packages.",
      dependsOn: ["pack"],
      inputs: packageInputs,
      cache: false,
      run: sh`pnpm async-pipeline publish github main --package .`
    }),
    "release.ensure": task({
      description: "Create or verify the release tag and GitHub Release before package publishing.",
      dependsOn: ["pack"],
      inputs: packageInputs,
      cache: false,
      run: sh`pnpm async-pipeline release ensure --package .`
    }),
    "publish.github": task({
      description: "Publish the stable GitHub Packages mirror before npm publishing.",
      dependsOn: ["release.ensure"],
      inputs: packageInputs,
      cache: false,
      run: sh`pnpm async-pipeline publish github release --package .`
    }),
    publish: task({
      description: "Publish the verified release to npm, then run release doctor.",
      dependsOn: ["publish.github"],
      inputs: packageInputs,
      cache: false,
      run: [
        sh`pnpm async-pipeline publish npm --package .`,
        sh`pnpm async-pipeline release doctor --package .`
      ]
    }),
    "release.doctor": task({
      description: "Diagnose release consistency for the current version.",
      dependsOn: ["pack"],
      inputs: packageInputs,
      cache: false,
      run: sh`pnpm async-pipeline release doctor --package .`
    })
  },
  jobs: {
    verify: job({
      target: "pack",
      trigger: ["pr", "main", "release", "manual"]
    }),
    snapshot: job({
      target: "snapshot",
      trigger: ["main"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "write",
          packages: "write"
        }
      }
    }),
    publish: job({
      target: "publish",
      trigger: ["manual", "release"],
      environment: {
        name: "npm-publish",
        url: "https://www.npmjs.com/package/@async/flow"
      },
      requires: {
        provenance: true
      },
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN"),
        NODE_AUTH_TOKEN: env.secret("npm_token")
      },
      github: {
        permissions: {
          contents: "write",
          idToken: "write",
          packages: "write"
        }
      }
    }),
    "release-doctor": job({
      description: "Diagnose release consistency for the current version.",
      target: "release.doctor",
      trigger: ["manual"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "read",
          packages: "read"
        }
      }
    })
  }
});
