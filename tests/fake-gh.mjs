// Stands in for gh in end-to-end tests. Fixtures (JSON files named by env vars):
//   PITLANE_FAKE_PRS       branch -> { url, state }                     pr list
//   PITLANE_FAKE_REVIEWS   [{ number, title, url, headRefName, author }] search prs --review-requested
//   PITLANE_FAKE_FEEDBACK  { reviewDecision, reviews, comments, statusCheckRollup }  pr view <url> --json reviewDecision,...
//   PITLANE_FAKE_POSTED    written: the body of each posted review     api repos/.../reviews
import fs from "node:fs";

const args = process.argv.slice(2);
const read = (name, fallback) => (process.env[name] && fs.existsSync(process.env[name]) ? JSON.parse(fs.readFileSync(process.env[name], "utf8")) : fallback);
const out = (value) => process.stdout.write(JSON.stringify(value));

if (args[0] === "search" && args[1] === "prs") {
  // As strict as the real gh: an unknown field is an error.
  const SEARCH_FIELDS = new Set(["assignees", "author", "authorAssociation", "body", "closedAt", "commentsCount", "createdAt", "id", "isDraft", "isLocked", "isPullRequest", "labels", "number", "repository", "state", "title", "updatedAt", "url"]);
  const unknown = (args[args.indexOf("--json") + 1] || "").split(",").filter((field) => !SEARCH_FIELDS.has(field));
  if (unknown.length) {
    process.stderr.write(`Unknown JSON field: "${unknown[0]}"\n`);
    process.exit(1);
  }
  out(read("PITLANE_FAKE_REVIEWS", []));
} else if (args[0] === "api" && args[1] === "user") {
  process.stdout.write("owner\n");
} else if (args[0] === "api" && /\/pulls\/\d+\/comments/.test(args[1] || "")) {
  out([]);
} else if (args[0] === "api" && /\/reviews$/.test(args[1] || "")) {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const posted = read("PITLANE_FAKE_POSTED", []);
    posted.push({ path: args[1], body: JSON.parse(input) });
    fs.writeFileSync(process.env.PITLANE_FAKE_POSTED, JSON.stringify(posted));
    out({ html_url: "https://github.com/acme/shop/pull/1#pullrequestreview-1" });
  });
} else if (args[0] === "pr" && args[1] === "view") {
  if ((args[3] || "").startsWith("reviewDecision") || args.includes("reviewDecision,reviews,comments,statusCheckRollup")) out(read("PITLANE_FAKE_FEEDBACK", {}));
  else out({ state: "OPEN" });
} else if (args.includes("--head")) {
  const prs = read("PITLANE_FAKE_PRS", {});
  const branch = args[args.indexOf("--head") + 1];
  out(prs[branch] ? [prs[branch]] : []);
} else {
  out(Object.entries(read("PITLANE_FAKE_PRS", {})).map(([headRefName, pr]) => ({ headRefName, ...pr })));
}
