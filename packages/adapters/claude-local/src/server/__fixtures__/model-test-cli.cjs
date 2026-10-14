const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const scenario = JSON.parse(fs.readFileSync(path.join(process.cwd(), "model-test-fixture.json"), "utf8"));
if (args.includes("--version")) {
  console.log("2.1.284");
} else if (args.includes("--help")) {
  console.log(scenario.help ?? "--print --output-format stream-json --verbose --no-session-persistence --tools --disallowedTools");
} else {
  let input = "";
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => {
    fs.appendFileSync(path.join(process.cwd(), "model-test-calls.jsonl"), JSON.stringify({
      args, input, cwd: process.cwd(), model: process.env.ANTHROPIC_MODEL, apiKey: process.env.ANTHROPIC_API_KEY,
    }) + "\n");
    setTimeout(() => {
      console.log(scenario.output ?? JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Hello!" }));
      process.exit(scenario.exitCode ?? 0);
    }, scenario.delayMs ?? 0);
  });
}
