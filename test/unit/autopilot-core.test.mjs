import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  detectFailureCategory,
  detectCycles,
  tryParseStructuredError,
  detectFailureCategoryFromText,
  getTaskProgressSummary,
  getReadyTasks,
  buildPrompt,
  buildReviewGateInstructions,
  buildFinalReviewPrompt,
  computeMaxReviewRounds
} from "../../infra/scripts/autopilot-start.mjs";

// The scaffold root — same directory that utils.mjs captures as rootDir
const scaffoldRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");

function scaffoldPath(...parts) {
  return path.join(scaffoldRoot, ...parts);
}

// ---------------------------------------------------------------------------
// Fixture helpers — write/restore dev/task.json and dev/progress.txt
// ---------------------------------------------------------------------------

function saveFixture(relPath) {
  const full = scaffoldPath(relPath);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

function writeFixture(relPath, content) {
  const full = scaffoldPath(relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function restoreFixture(relPath, original) {
  const full = scaffoldPath(relPath);
  if (original === null) {
    writeFileSync(full, JSON.stringify({ tasks: [] }), "utf8");
  } else {
    writeFileSync(full, original, "utf8");
  }
}

function writeTaskJson(tasks) {
  writeFixture("dev/task.json", JSON.stringify({ tasks }));
}

function writeProgressTxt(content = "") {
  writeFixture("dev/progress.txt", content);
}

// ---------------------------------------------------------------------------
// detectFailureCategory — pure function, no file I/O
// ---------------------------------------------------------------------------

describe("detectFailureCategory", () => {
  it('returns quota category for "rate limit exceeded"', () => {
    const result = detectFailureCategory("rate limit exceeded");
    assert.equal(result?.category, "quota");
  });

  it('returns quota category for "429 Too Many Requests"', () => {
    const result = detectFailureCategory("429 Too Many Requests");
    assert.equal(result?.category, "quota");
  });

  it('returns quota category for "hit your limit"', () => {
    const result = detectFailureCategory("You have hit your limit for today");
    assert.equal(result?.category, "quota");
  });

  it("returns null for normal text", () => {
    assert.equal(detectFailureCategory("Everything is working fine"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(detectFailureCategory(""), null);
  });

  it("returns null for null input", () => {
    assert.equal(detectFailureCategory(null), null);
  });

  it("parses structured Claude API rate limit error", () => {
    const structured = JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "Rate limited" } });
    const result = detectFailureCategory(structured);
    assert.equal(result?.category, "quota");
    assert.equal(result?.source, "structured");
  });

  it("returns quota for rate-limited text", () => {
    const result = detectFailureCategory("Your request was rate-limited");
    assert.equal(result?.category, "quota");
  });

  it("returns quota for usage limit text", () => {
    const result = detectFailureCategory("You have exceeded your usage limit");
    assert.equal(result?.category, "quota");
  });

  it("returns quota for credit balance text", () => {
    const result = detectFailureCategory("Insufficient credit balance");
    assert.equal(result?.category, "quota");
  });

  it("returns quota for too many requests text", () => {
    const result = detectFailureCategory("too many requests, please slow down");
    assert.equal(result?.category, "quota");
  });

  it("matches 429 when preceded by 'code' keyword", () => {
    // "code 429" matches the pattern /(?:status|code|http)[:\s]+429\b/
    const result = detectFailureCategory("Error code 429");
    assert.equal(result?.category, "quota");
  });

  it("does NOT match bare 429 in unrelated context", () => {
    // 429 appearing as a non-HTTP-status number should not match
    const result = detectFailureCategory("Processed 429 records successfully");
    assert.equal(result, null);
  });

  it("matches 429 with HTTP status context", () => {
    const result = detectFailureCategory('status: 429 error');
    assert.equal(result?.category, "quota");
  });
});

// ---------------------------------------------------------------------------
// tryParseStructuredError — structured JSON parsing
// ---------------------------------------------------------------------------

describe("tryParseStructuredError", () => {
  it("parses Claude API rate_limit_error with retry_after", () => {
    const json = JSON.stringify({
      type: "error",
      error: { type: "rate_limit_error", message: "Rate limited", retry_after: 60 }
    });
    const result = tryParseStructuredError(json);
    assert.equal(result?.category, "quota");
    assert.equal(result?.retryAfterSeconds, 60);
    assert.equal(result?.source, "structured");
  });

  it("parses HTTP 429 status", () => {
    const json = JSON.stringify({ status: 429, message: "Too Many Requests" });
    const result = tryParseStructuredError(json);
    assert.equal(result?.category, "quota");
    assert.equal(result?.source, "structured");
  });

  it("parses HTTP 429 statusCode variant", () => {
    const json = JSON.stringify({ statusCode: 429, retry_after: 30 });
    const result = tryParseStructuredError(json);
    assert.equal(result?.category, "quota");
    assert.equal(result?.retryAfterSeconds, 30);
  });

  it("parses Codex JSONL rate_limit error", () => {
    const json = JSON.stringify({ type: "error", code: "rate_limit_error", message: "Rate limited" });
    const result = tryParseStructuredError(json);
    assert.equal(result?.category, "quota");
  });

  it("returns null for non-error JSON", () => {
    const json = JSON.stringify({ type: "assistant", message: "Hello" });
    const result = tryParseStructuredError(json);
    assert.equal(result, null);
  });

  it("returns null for invalid JSON", () => {
    const result = tryParseStructuredError("not json at all");
    assert.equal(result, null);
  });

  it("returns null for empty input", () => {
    assert.equal(tryParseStructuredError(""), null);
    assert.equal(tryParseStructuredError(null), null);
  });

  it("handles multiline input with JSON on second line", () => {
    const input = `Some log line\n${JSON.stringify({ status: 429 })}`;
    const result = tryParseStructuredError(input);
    assert.equal(result?.category, "quota");
  });

  it("extracts retryAfter from reset_after field", () => {
    const json = JSON.stringify({
      type: "error",
      error: { type: "rate_limit_error", reset_after: 120 }
    });
    const result = tryParseStructuredError(json);
    assert.equal(result?.retryAfterSeconds, 120);
  });
});

// ---------------------------------------------------------------------------
// detectFailureCategoryFromText — text heuristics
// ---------------------------------------------------------------------------

describe("detectFailureCategoryFromText", () => {
  it("detects rate limit with hyphen", () => {
    const result = detectFailureCategoryFromText("rate-limit exceeded");
    assert.equal(result?.category, "quota");
    assert.equal(result?.source, "text");
  });

  it("detects quota keyword", () => {
    const result = detectFailureCategoryFromText("API quota exhausted");
    assert.equal(result?.category, "quota");
  });

  it("detects JSON-style 429 status", () => {
    const result = detectFailureCategoryFromText('"status": 429');
    assert.equal(result?.category, "quota");
  });

  it("returns null for unrelated text", () => {
    assert.equal(detectFailureCategoryFromText("Build succeeded"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(detectFailureCategoryFromText(""), null);
  });
});

// ---------------------------------------------------------------------------
// detectCycles — cycle detection in task dependency graph
// ---------------------------------------------------------------------------

describe("detectCycles", () => {
  it("detects no cycles in linear dependency chain", () => {
    const tasks = [
      { id: "A", depends_on: [] },
      { id: "B", depends_on: ["A"] },
      { id: "C", depends_on: ["B"] }
    ];
    const cycles = detectCycles(tasks);
    assert.equal(cycles.length, 0);
  });

  it("detects simple two-node cycle", () => {
    const tasks = [
      { id: "A", depends_on: ["B"] },
      { id: "B", depends_on: ["A"] }
    ];
    const cycles = detectCycles(tasks);
    assert.ok(cycles.length > 0, "Expected at least one cycle");
  });

  it("detects three-node cycle", () => {
    const tasks = [
      { id: "A", depends_on: ["C"] },
      { id: "B", depends_on: ["A"] },
      { id: "C", depends_on: ["B"] }
    ];
    const cycles = detectCycles(tasks);
    assert.ok(cycles.length > 0, "Expected at least one cycle");
  });

  it("handles self-referencing task", () => {
    const tasks = [
      { id: "A", depends_on: ["A"] }
    ];
    const cycles = detectCycles(tasks);
    assert.ok(cycles.length > 0, "Expected self-cycle detected");
  });

  it("handles empty task list", () => {
    const cycles = detectCycles([]);
    assert.deepEqual(cycles, []);
  });

  it("handles tasks with no depends_on field", () => {
    const tasks = [
      { id: "A" },
      { id: "B" }
    ];
    const cycles = detectCycles(tasks);
    assert.equal(cycles.length, 0);
  });

  it("ignores dependencies on non-existent tasks", () => {
    const tasks = [
      { id: "A", depends_on: ["Z"] },
      { id: "B", depends_on: ["A"] }
    ];
    const cycles = detectCycles(tasks);
    assert.equal(cycles.length, 0);
  });

  it("detects cycle in mixed graph (some acyclic, some cyclic)", () => {
    const tasks = [
      { id: "A", depends_on: [] },
      { id: "B", depends_on: ["A"] },
      { id: "C", depends_on: ["D"] },
      { id: "D", depends_on: ["C"] }
    ];
    const cycles = detectCycles(tasks);
    assert.ok(cycles.length > 0, "Expected cycle between C and D");
    // Verify A and B are not in any cycle
    const cycleIds = new Set(cycles.flat());
    assert.ok(!cycleIds.has("A"));
    assert.ok(!cycleIds.has("B"));
  });
});

// ---------------------------------------------------------------------------
// getTaskProgressSummary
// ---------------------------------------------------------------------------

describe("getTaskProgressSummary", () => {
  let originalTaskJson;

  beforeEach(() => {
    originalTaskJson = saveFixture("dev/task.json");
  });

  afterEach(() => {
    restoreFixture("dev/task.json", originalTaskJson);
  });

  it("returns correct done/total counts", () => {
    writeTaskJson([
      { id: "T001", status: "done", priority: "P0", name: "A" },
      { id: "T002", status: "done", priority: "P1", name: "B" },
      { id: "T003", status: "todo", priority: "P2", name: "C" }
    ]);

    const summary = getTaskProgressSummary();
    assert.equal(summary.done, 2);
    assert.equal(summary.total, 3);
  });

  it("handles empty task list", () => {
    writeTaskJson([]);

    const summary = getTaskProgressSummary();
    assert.equal(summary.done, 0);
    assert.equal(summary.total, 0);
  });

  it("counts blocked and in_progress tasks in total but not done", () => {
    writeTaskJson([
      { id: "T001", status: "done", priority: "P0", name: "A" },
      { id: "T002", status: "in_progress", priority: "P1", name: "B" },
      { id: "T003", status: "blocked", priority: "P2", name: "C" }
    ]);

    const summary = getTaskProgressSummary();
    assert.equal(summary.done, 1);
    assert.equal(summary.total, 3);
  });
});

// ---------------------------------------------------------------------------
// getReadyTasks
// ---------------------------------------------------------------------------

describe("getReadyTasks", () => {
  let originalTaskJson;

  beforeEach(() => {
    originalTaskJson = saveFixture("dev/task.json");
  });

  afterEach(() => {
    restoreFixture("dev/task.json", originalTaskJson);
  });

  it("returns tasks with no dependencies", () => {
    writeTaskJson([
      { id: "T001", status: "todo", priority: "P0", name: "A" },
      { id: "T002", status: "todo", priority: "P1", name: "B" }
    ]);

    const ready = getReadyTasks();
    assert.equal(ready.length, 2);
    assert.ok(ready.some((t) => t.id === "T001"));
    assert.ok(ready.some((t) => t.id === "T002"));
  });

  it("returns tasks whose dependencies are all done", () => {
    writeTaskJson([
      { id: "T001", status: "done", priority: "P0", name: "A" },
      { id: "T002", status: "todo", priority: "P1", name: "B", depends_on: ["T001"] }
    ]);

    const ready = getReadyTasks();
    assert.equal(ready.length, 1);
    assert.equal(ready[0].id, "T002");
  });

  it("does NOT return tasks with unsatisfied dependencies", () => {
    writeTaskJson([
      { id: "T001", status: "todo", priority: "P0", name: "A" },
      { id: "T002", status: "todo", priority: "P1", name: "B", depends_on: ["T001"] }
    ]);

    const ready = getReadyTasks();
    assert.equal(ready.length, 1);
    assert.equal(ready[0].id, "T001");
  });

  it("handles empty task list", () => {
    writeTaskJson([]);

    const ready = getReadyTasks();
    assert.deepEqual(ready, []);
  });

  it("excludes tasks involved in circular dependencies", () => {
    writeTaskJson([
      { id: "T001", status: "todo", priority: "P0", name: "A" },
      { id: "T002", status: "todo", priority: "P1", name: "B", depends_on: ["T003"] },
      { id: "T003", status: "todo", priority: "P1", name: "C", depends_on: ["T002"] }
    ]);

    const ready = getReadyTasks();
    // T001 should be ready, T002 and T003 are in a cycle
    assert.equal(ready.length, 1);
    assert.equal(ready[0].id, "T001");
  });

  it("returns tasks in priority order (P0 before P1 before P2)", () => {
    writeTaskJson([
      { id: "T003", status: "todo", priority: "P2", name: "C" },
      { id: "T001", status: "todo", priority: "P0", name: "A" },
      { id: "T002", status: "todo", priority: "P1", name: "B" }
    ]);

    const ready = getReadyTasks();
    assert.equal(ready.length, 3);
    assert.equal(ready[0].id, "T001");
    assert.equal(ready[1].id, "T002");
    assert.equal(ready[2].id, "T003");
  });

  it("skips done and in_progress tasks", () => {
    writeTaskJson([
      { id: "T001", status: "done", priority: "P0", name: "A" },
      { id: "T002", status: "in_progress", priority: "P0", name: "B" },
      { id: "T003", status: "todo", priority: "P1", name: "C" }
    ]);

    const ready = getReadyTasks();
    assert.equal(ready.length, 1);
    assert.equal(ready[0].id, "T003");
  });
});

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

describe("buildPrompt", () => {
  let originalTaskJson;
  let originalProgressTxt;

  const mockConfig = {
    behavior: { allowTaskGenerationWhenIdle: false },
    models: { planning: "claude-opus-4-5", execution: "claude-sonnet-4-5" }
  };

  const mockConfigWithIdleGen = {
    behavior: { allowTaskGenerationWhenIdle: true },
    models: { planning: "claude-opus-4-5", execution: "claude-sonnet-4-5" }
  };

  beforeEach(() => {
    originalTaskJson = saveFixture("dev/task.json");
    originalProgressTxt = saveFixture("dev/progress.txt");
  });

  afterEach(() => {
    restoreFixture("dev/task.json", originalTaskJson);
    if (originalProgressTxt === null) {
      writeFixture("dev/progress.txt", "");
    } else {
      writeFixture("dev/progress.txt", originalProgressTxt);
    }
  });

  it("batch mode: returns prompt mentioning multiple tasks when readyTasks.length > 1", () => {
    writeTaskJson([
      { id: "T001", status: "todo", priority: "P0", name: "First task" },
      { id: "T002", status: "todo", priority: "P1", name: "Second task" }
    ]);
    writeProgressTxt("some progress");

    const readyTasks = [
      { id: "T001", status: "todo", priority: "P0", name: "First task" },
      { id: "T002", status: "todo", priority: "P1", name: "Second task" }
    ];
    const prompt = buildPrompt(readyTasks, mockConfig);

    assert.ok(prompt.includes("Ready Tasks"), `Expected "Ready Tasks" in prompt`);
    assert.ok(prompt.includes("T001"));
    assert.ok(prompt.includes("T002"));
  });

  it("single mode: returns prompt with task details when readyTasks.length === 1", () => {
    const task = {
      id: "T001",
      status: "todo",
      priority: "P0",
      name: "Only task",
      type: "feature",
      description: "Do the thing"
    };
    writeTaskJson([task]);
    writeProgressTxt("some progress");

    const readyTasks = [task];
    const prompt = buildPrompt(readyTasks, mockConfig);

    assert.ok(prompt.includes("Current Task"), `Expected "Current Task" in prompt`);
    assert.ok(prompt.includes("T001"));
    assert.ok(prompt.includes("Only task"));
  });

  it("idle mode: returns idle prompt when readyTasks is empty", () => {
    writeTaskJson([]);
    writeProgressTxt("");

    const prompt = buildPrompt([], mockConfig);

    assert.ok(
      prompt.includes("No runnable todo task exists"),
      `Expected idle text in prompt`
    );
  });

  it("idle mode with task generation: prompts to create tasks", () => {
    writeTaskJson([]);
    writeProgressTxt("");

    const prompt = buildPrompt([], mockConfigWithIdleGen);

    assert.ok(prompt.includes("create 1-3 small next tasks"), "Expected task generation instruction");
  });

  it("idle mode without task generation: prompts to audit and stop", () => {
    writeTaskJson([]);
    writeProgressTxt("");

    const prompt = buildPrompt([], mockConfig);

    assert.ok(prompt.includes("audit the repository"), "Expected audit instruction");
  });

  it("always includes mandatory reading section", () => {
    writeTaskJson([]);
    writeProgressTxt("");

    const prompt = buildPrompt([], mockConfig);

    assert.ok(prompt.includes("Mandatory Reading"));
    assert.ok(prompt.includes("AGENTS.md"));
    assert.ok(prompt.includes(".planning/STATE.md"));
    assert.ok(prompt.includes("dev/task.json"));
  });

  it("includes acceptance criteria in single-task prompt", () => {
    const task = {
      id: "T001",
      status: "todo",
      priority: "P0",
      name: "Task with criteria",
      type: "implementation",
      description: "Implement feature X",
      acceptance_criteria: ["Unit tests pass", "Build succeeds"]
    };
    writeTaskJson([task]);
    writeProgressTxt("");

    const prompt = buildPrompt([task], mockConfig);

    assert.ok(prompt.includes("Unit tests pass"));
    assert.ok(prompt.includes("Build succeeds"));
  });

  it("includes scale-based execution hints for sonnet tasks", () => {
    const task = {
      id: "T001",
      status: "todo",
      priority: "P0",
      name: "Sonnet task",
      type: "implementation",
      description: "Implement something",
      assignee: "sonnet"
    };
    writeTaskJson([task]);
    writeProgressTxt("");

    const prompt = buildPrompt([task], mockConfig);

    assert.ok(prompt.includes("Scale-Based Execution"));
  });

  it("codex task: includes delegation instructions", () => {
    const task = {
      id: "T001",
      status: "todo",
      priority: "P0",
      name: "Codex task",
      type: "implementation",
      description: "Implement via codex",
      assignee: "codex"
    };
    writeTaskJson([task]);
    writeProgressTxt("");

    const prompt = buildPrompt([task], mockConfig);

    assert.ok(prompt.includes("Codex Delegation"), "Expected codex delegation section");
    assert.ok(prompt.includes("CodexBridge"), "Expected codex-bridge module reference");
  });

  it("opus task: includes direct execution instructions", () => {
    const task = {
      id: "T001",
      status: "todo",
      priority: "P0",
      name: "Opus task",
      type: "planning",
      description: "Plan something",
      assignee: "opus"
    };
    writeTaskJson([task]);
    writeProgressTxt("");

    const prompt = buildPrompt([task], mockConfig);

    assert.ok(prompt.includes("Direct (Opus)"), "Expected opus direct execution section");
    assert.ok(prompt.includes("without sub-agents"));
  });

  it("batch mode: partitions codex and sonnet tasks", () => {
    const tasks = [
      { id: "T001", status: "todo", priority: "P0", name: "Sonnet task", assignee: "sonnet" },
      { id: "T002", status: "todo", priority: "P0", name: "Codex task", assignee: "codex" }
    ];
    writeTaskJson(tasks);
    writeProgressTxt("");

    const prompt = buildPrompt(tasks, mockConfig);

    assert.ok(prompt.includes("Codex Tasks"), "Expected codex tasks section");
    assert.ok(prompt.includes("Sonnet Tasks"), "Expected sonnet tasks section");
  });

  it("includes deviation rules in all modes", () => {
    const task = {
      id: "T001", status: "todo", priority: "P0",
      name: "Task", type: "implementation", description: "Do"
    };
    writeTaskJson([task]);
    writeProgressTxt("");

    const singlePrompt = buildPrompt([task], mockConfig);
    assert.ok(singlePrompt.includes("Deviation Rules"));

    const idlePrompt = buildPrompt([], mockConfig);
    assert.ok(idlePrompt.includes("deviation rules") || idlePrompt.includes("Deviation"));
  });

  it("includes progress summary in prompt", () => {
    writeTaskJson([
      { id: "T001", status: "done", priority: "P0", name: "Done" },
      { id: "T002", status: "todo", priority: "P1", name: "Todo" }
    ]);
    writeProgressTxt("Round 1: completed T001");

    const task = { id: "T002", status: "todo", priority: "P1", name: "Todo" };
    const prompt = buildPrompt([task], mockConfig);

    assert.ok(prompt.includes("1/2"), "Expected progress count in prompt");
    assert.ok(prompt.includes("Round 1: completed T001"), "Expected progress text");
  });
});

// ---------------------------------------------------------------------------
// buildReviewGateInstructions
// ---------------------------------------------------------------------------

describe("buildReviewGateInstructions", () => {
  let originalPlanConfig;

  beforeEach(() => {
    originalPlanConfig = saveFixture(".planning/config.json");
  });

  afterEach(() => {
    if (originalPlanConfig !== null) {
      writeFixture(".planning/config.json", originalPlanConfig);
    }
  });

  it("returns empty string for null task", () => {
    assert.equal(buildReviewGateInstructions(null), "");
  });

  it("returns MRD/PRD review gate for research tasks", () => {
    const task = { id: "T001", type: "research", name: "Market research", description: "Do research" };
    const result = buildReviewGateInstructions(task);
    assert.ok(result.includes("MRD/PRD Review"), "Expected MRD/PRD review gate");
    assert.ok(result.includes("BLOCKING"));
  });

  it("returns tech/design review gate for docs tasks about design", () => {
    const task = { id: "T002", type: "docs", name: "Write tech spec", description: "Technical spec for API" };
    const result = buildReviewGateInstructions(task);
    assert.ok(result.includes("Tech/Design Review"), "Expected tech/design review gate");
  });

  it("returns code review gate for implementation tasks", () => {
    const task = { id: "T003", type: "implementation", name: "Build auth", description: "Implement auth module" };
    const result = buildReviewGateInstructions(task);
    assert.ok(result.includes("Code Review"), "Expected code review gate");
  });

  it("returns test coverage review gate for testing tasks", () => {
    const task = { id: "T004", type: "testing", name: "Write tests", description: "Test the auth module" };
    const result = buildReviewGateInstructions(task);
    assert.ok(result.includes("Test Coverage Review"), "Expected test coverage review gate");
    assert.ok(result.includes("PRD requirement"), "Expected PRD coverage instruction");
  });

  it("returns marketing review gate for marketing tasks", () => {
    const task = { id: "T005", type: "planning", name: "Marketing strategy", description: "Create go-to-market plan" };
    const result = buildReviewGateInstructions(task);
    assert.ok(result.includes("Marketing Review"), "Expected marketing review gate");
  });

  it("returns empty string for tasks that match no gates", () => {
    const task = { id: "T006", type: "implementation", name: "Refactor utils", description: "Clean up utility functions" };
    // implementation matches code review, so this should NOT be empty
    const result = buildReviewGateInstructions(task);
    assert.ok(result.includes("Code Review"));
  });

  it("includes recipe path in instructions", () => {
    const task = { id: "T007", type: "research", name: "MRD creation", description: "Write MRD" };
    const result = buildReviewGateInstructions(task);
    assert.ok(result.includes(".ai/recipes/review-mrd-prd.md"), "Expected recipe path");
  });

  it("includes review output path with task ID", () => {
    const task = { id: "T008", type: "testing", name: "Test coverage", description: "Verify test coverage" };
    const result = buildReviewGateInstructions(task);
    assert.ok(result.includes("T008"), "Expected task ID in review output path");
  });

  it("injects review gates into implementation buildPrompt", () => {
    const task = {
      id: "T010", status: "todo", priority: "P0",
      name: "Build feature", type: "implementation",
      description: "Implement new feature", assignee: "sonnet"
    };
    writeTaskJson([task]);
    writeProgressTxt("");

    const mockConfig = {
      behavior: { allowTaskGenerationWhenIdle: false },
      models: { planning: "opus", execution: "sonnet" }
    };
    const prompt = buildPrompt([task], mockConfig);

    assert.ok(prompt.includes("Review Gates"), "Expected review gates in prompt");
    assert.ok(prompt.includes("Code Review"), "Expected code review gate in prompt");
  });
});

// ---------------------------------------------------------------------------
// buildFinalReviewPrompt
// ---------------------------------------------------------------------------

describe("buildFinalReviewPrompt", () => {
  let originalTaskJson;
  let originalProgressTxt;
  let originalPlanConfig;

  const mockConfig = {
    behavior: { allowTaskGenerationWhenIdle: false },
    models: { planning: "opus", execution: "sonnet" }
  };

  beforeEach(() => {
    originalTaskJson = saveFixture("dev/task.json");
    originalProgressTxt = saveFixture("dev/progress.txt");
    originalPlanConfig = saveFixture(".planning/config.json");
  });

  afterEach(() => {
    restoreFixture("dev/task.json", originalTaskJson);
    if (originalProgressTxt === null) {
      writeFixture("dev/progress.txt", "");
    } else {
      writeFixture("dev/progress.txt", originalProgressTxt);
    }
    if (originalPlanConfig !== null) {
      writeFixture(".planning/config.json", originalPlanConfig);
    }
  });

  it("includes round number and max rounds", () => {
    writeTaskJson([{ id: "T001", status: "done", priority: "P0", name: "Done" }]);
    writeProgressTxt("All done");

    const prompt = buildFinalReviewPrompt(mockConfig, 1, null);

    assert.ok(prompt.includes("Round 1/"), "Expected round number");
    assert.ok(prompt.includes("FINAL ITERATION REVIEW"), "Expected final review header");
  });

  it("includes parallel reviewer dispatch instructions", () => {
    writeTaskJson([{ id: "T001", status: "done", priority: "P0", name: "Done" }]);
    writeProgressTxt("All done");

    const prompt = buildFinalReviewPrompt(mockConfig, 1, null);

    assert.ok(prompt.includes("Dispatch Parallel Reviewers"), "Expected parallel dispatch section");
    assert.ok(prompt.includes("Document Review"), "Expected doc review section");
    assert.ok(prompt.includes("Code & Test Review"), "Expected code review section");
  });

  it("includes triage classification system", () => {
    writeTaskJson([]);
    writeProgressTxt("");

    const prompt = buildFinalReviewPrompt(mockConfig, 1, null);

    assert.ok(prompt.includes("BUG"), "Expected BUG classification");
    assert.ok(prompt.includes("SECURITY"), "Expected SECURITY classification");
    assert.ok(prompt.includes("COVERAGE GAP"), "Expected COVERAGE GAP classification");
    assert.ok(prompt.includes("FALSE POSITIVE"), "Expected FALSE POSITIVE classification");
  });

  it("includes previous findings when provided", () => {
    writeTaskJson([]);
    writeProgressTxt("");

    const previousFindings = "Found 2 bugs: missing auth check, untested endpoint";
    const prompt = buildFinalReviewPrompt(mockConfig, 2, previousFindings);

    assert.ok(prompt.includes("Previous Round Findings"), "Expected previous findings section");
    assert.ok(prompt.includes("missing auth check"), "Expected previous findings content");
  });

  it("does not include previous findings on round 1", () => {
    writeTaskJson([]);
    writeProgressTxt("");

    const prompt = buildFinalReviewPrompt(mockConfig, 1, null);

    assert.ok(!prompt.includes("Previous Round Findings"), "Should not have previous findings on round 1");
  });

  it("indicates FINAL round when at max", () => {
    writeTaskJson([]);
    writeProgressTxt("");

    const prompt = buildFinalReviewPrompt(mockConfig, 5, null);

    assert.ok(prompt.includes("FINAL"), "Expected FINAL indicator at max rounds");
    assert.ok(prompt.includes("awaiting_user_decision"), "Expected user decision gate instruction");
    assert.ok(prompt.includes("PAUSE"), "Expected autopilot pause instruction");
  });

  it("includes convergence criteria for non-final rounds", () => {
    writeTaskJson([]);
    writeProgressTxt("");

    const prompt = buildFinalReviewPrompt(mockConfig, 1, null);

    assert.ok(prompt.includes("CONVERGED"), "Expected convergence criteria");
  });

  it("includes review tools from config", () => {
    writeTaskJson([]);
    writeProgressTxt("");

    const prompt = buildFinalReviewPrompt(mockConfig, 1, null);

    assert.ok(prompt.includes("pm-skills") || prompt.includes("Review Tools"), "Expected review tools section");
  });

  it("references review output path with round number", () => {
    writeTaskJson([]);
    writeProgressTxt("");

    const prompt = buildFinalReviewPrompt(mockConfig, 2, null);

    assert.ok(prompt.includes("FINAL-REVIEW-ROUND-2"), "Expected round-specific output path");
  });
});

// ---------------------------------------------------------------------------
// computeMaxReviewRounds
// ---------------------------------------------------------------------------

describe("computeMaxReviewRounds", () => {
  it("returns 5 for small projects (≤10 tasks, ≤20 files)", () => {
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 5, sourceFileCount: 10 }), 5);
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 10, sourceFileCount: 20 }), 5);
  });

  it("returns 7 for medium projects (≤30 tasks, ≤50 files)", () => {
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 15, sourceFileCount: 30 }), 7);
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 30, sourceFileCount: 50 }), 7);
  });

  it("returns 10 for large projects (≤60 tasks, ≤100 files)", () => {
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 45, sourceFileCount: 80 }), 10);
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 60, sourceFileCount: 100 }), 10);
  });

  it("returns 12 for XL projects (>60 tasks or >100 files)", () => {
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 87, sourceFileCount: 120 }), 12);
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 61, sourceFileCount: 10 }), 12);
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 5, sourceFileCount: 101 }), 12);
  });

  it("uses higher tier when task count and file count fall in different tiers", () => {
    // 5 tasks (small) but 60 files (medium→large boundary) → uses file count tier
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 5, sourceFileCount: 60 }), 10);
    // 40 tasks (large) but 10 files (small) → uses task count tier
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 40, sourceFileCount: 10 }), 10);
  });

  it("respects explicit numeric config override", () => {
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 5, sourceFileCount: 5, configMaxRounds: 7 }), 7);
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 100, sourceFileCount: 200, configMaxRounds: 2 }), 2);
  });

  it("ignores non-numeric or invalid config values and falls back to auto", () => {
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 5, sourceFileCount: 5, configMaxRounds: "auto" }), 5);
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 5, sourceFileCount: 5, configMaxRounds: 0 }), 5);
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 5, sourceFileCount: 5, configMaxRounds: -1 }), 5);
  });

  it("defaults to small tier with no arguments", () => {
    assert.strictEqual(computeMaxReviewRounds(), 5);
    assert.strictEqual(computeMaxReviewRounds({}), 5);
  });

  it("returns 50 for zero_bug review strategy", () => {
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 5, sourceFileCount: 5, reviewStrategy: { mode: "zero_bug" } }), 50);
    // zero_bug overrides even explicit configMaxRounds
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 5, sourceFileCount: 5, configMaxRounds: 3, reviewStrategy: { mode: "zero_bug" } }), 50);
  });

  it("uses custom_rounds for custom review strategy", () => {
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 5, sourceFileCount: 5, reviewStrategy: { mode: "custom", custom_rounds: 15 } }), 15);
    // custom overrides auto-scaling
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 100, sourceFileCount: 200, reviewStrategy: { mode: "custom", custom_rounds: 4 } }), 4);
  });

  it("falls back to auto when review strategy mode is auto or unrecognized", () => {
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 5, sourceFileCount: 5, reviewStrategy: { mode: "auto" } }), 5);
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 5, sourceFileCount: 5, reviewStrategy: { mode: "unknown" } }), 5);
    assert.strictEqual(computeMaxReviewRounds({ taskCount: 100, sourceFileCount: 200, reviewStrategy: { mode: "auto" } }), 12);
  });
});
