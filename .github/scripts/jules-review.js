'use strict';

const fs = require('node:fs');

const JULES_API = 'https://jules.googleapis.com/v1alpha';
const POLL_INTERVAL_MS = 15_000;
const MAX_WAIT_MS = 18 * 60 * 1000;
const MAX_DIFF_CHARS = 60_000;

const {
  JULES_API_KEY,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  PR_NUMBER,
  PR_HEAD_SHA,
  BASE_REF,
  DIFF_FILE,
} = process.env;

function requireEnv(name, value) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

requireEnv('JULES_API_KEY', JULES_API_KEY);
requireEnv('GITHUB_TOKEN', GITHUB_TOKEN);
requireEnv('GITHUB_REPOSITORY', GITHUB_REPOSITORY);
requireEnv('PR_NUMBER', PR_NUMBER);
requireEnv('PR_HEAD_SHA', PR_HEAD_SHA);
requireEnv('BASE_REF', BASE_REF);
requireEnv('DIFF_FILE', DIFF_FILE);

const [OWNER, REPO] = GITHUB_REPOSITORY.split('/');

async function julesFetch(path, options = {}) {
  const res = await fetch(`${JULES_API}${path}`, {
    ...options,
    headers: {
      'x-goog-api-key': JULES_API_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const error = new Error(`Jules API ${path} failed: ${res.status} ${body}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

async function githubFetch(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${path} failed: ${res.status} ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

async function findSource() {
  let pageToken;
  do {
    const qs = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '';
    const data = await julesFetch(`/sources${qs}`);
    const match = (data.sources || []).find(
      (s) =>
        s.githubRepo &&
        s.githubRepo.owner === OWNER &&
        s.githubRepo.repo === REPO
    );
    if (match) return match;
    pageToken = data.nextPageToken;
  } while (pageToken);
  return null;
}

function buildPrompt(diff) {
  const truncated = diff.length > MAX_DIFF_CHARS;
  const diffSnippet = truncated ? diff.slice(0, MAX_DIFF_CHARS) : diff;

  return `You are a senior code reviewer. Review ONLY the unified diff below from a pull request. Do not modify any code — analysis only.

Focus areas:
- SOLID and KISS principles
- Readable, well-structured, maintainable code
- Common security vulnerabilities (injection, unsafe input handling, secrets, auth/JWT issues, etc.)

For each issue you find:
- Only reference lines that appear as added/context lines (lines starting with "+" or " ") in the diff below, using the file path and the NEW file line number.
- Write a clear, constructive comment explaining what to improve and how.
- Include a short example of the better practice (a code suggestion is welcome).
- Include a reference URL to relevant documentation when useful.
- Classify the finding's priority as "High", "Medium", or "Low".

Respond with ONLY a single JSON code block (\`\`\`json ... \`\`\`) containing an array of objects with this exact shape, and nothing else:

[
  {
    "path": "relative/file/path.js",
    "line": 42,
    "priority": "High" | "Medium" | "Low",
    "title": "short title",
    "comment": "what to improve and how, in English",
    "suggestion": "optional short code suggestion",
    "reference": "optional URL to documentation"
  }
]

If there are no issues, respond with an empty array: \`\`\`json\n[]\n\`\`\`

${truncated ? 'NOTE: the diff was truncated due to size; review what is shown.\n\n' : ''}Diff:
\`\`\`diff
${diffSnippet}
\`\`\`
`;
}

async function createSession(source, diff) {
  const session = await julesFetch('/sessions', {
    method: 'POST',
    body: JSON.stringify({
      prompt: buildPrompt(diff),
      sourceContext: {
        source: source.name,
        githubRepoContext: {
          startingBranch: BASE_REF,
        },
      },
      automationMode: 'AUTOMATION_MODE_UNSPECIFIED',
      title: `Code review for PR #${PR_NUMBER}`,
    }),
  });
  return session;
}

async function waitForCompletion(sessionName) {
  const deadline = Date.now() + MAX_WAIT_MS;
  let messages = [];
  let seenIds = new Set();
  let status = 'RUNNING';
  let notFoundRetries = 0;
  const MAX_NOT_FOUND_RETRIES = 5;

  while (Date.now() < deadline) {
    let data;
    try {
      data = await julesFetch(`/${sessionName}/activities?pageSize=50`);
    } catch (err) {
      if (err.status === 404 && notFoundRetries < MAX_NOT_FOUND_RETRIES) {
        // The session may not be queryable yet right after creation
        // (eventual consistency on the alpha API). Retry a few times.
        notFoundRetries += 1;
        console.log(
          `Session not queryable yet (404), retry ${notFoundRetries}/${MAX_NOT_FOUND_RETRIES}...`
        );
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      throw err;
    }
    notFoundRetries = 0;
    for (const activity of data.activities || []) {
      if (seenIds.has(activity.id)) continue;
      seenIds.add(activity.id);

      if (activity.agentMessaged && activity.agentMessaged.agentMessage) {
        messages.push(activity.agentMessaged.agentMessage);
      }
      if (activity.sessionCompleted) status = 'COMPLETED';
      if (activity.sessionFailed) status = 'FAILED';
    }

    if (status === 'COMPLETED' || status === 'FAILED') {
      return { status, messages };
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  return { status: 'TIMEOUT', messages };
}

function extractFindings(messages) {
  const combined = messages.join('\n');
  const matches = [...combined.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (matches.length === 0) return { findings: null, raw: combined };

  const lastBlock = matches[matches.length - 1][1].trim();
  try {
    const parsed = JSON.parse(lastBlock);
    if (Array.isArray(parsed)) return { findings: parsed, raw: combined };
    return { findings: null, raw: combined };
  } catch {
    return { findings: null, raw: combined };
  }
}

// Parses a unified diff and returns a Map<path, Set<newLineNumber>> of
// lines that are part of the diff's "RIGHT" (new file) side and can be
// targeted by a GitHub PR review comment.
function buildCommentableLines(diffText) {
  const map = new Map();
  let currentPath = null;
  let newLine = null;

  const lines = diffText.split('\n');
  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      const filePath = line.slice(4).trim();
      currentPath = filePath === '/dev/null' ? null : filePath.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('@@')) {
      const m = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      newLine = m ? parseInt(m[1], 10) : null;
      continue;
    }
    if (!currentPath || newLine === null) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (!map.has(currentPath)) map.set(currentPath, new Set());
      map.get(currentPath).add(newLine);
      newLine += 1;
    } else if (line.startsWith(' ')) {
      if (!map.has(currentPath)) map.set(currentPath, new Set());
      map.get(currentPath).add(newLine);
      newLine += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // removed line, does not advance the new-file line counter
    }
  }
  return map;
}

const PRIORITY_BADGE = {
  High: '🔴 **[High]**',
  Medium: '🟡 **[Medium]**',
  Low: '🟢 **[Low]**',
};

function formatCommentBody(finding) {
  const badge = PRIORITY_BADGE[finding.priority] || `**[${finding.priority || 'Unknown'}]**`;
  let body = `${badge} ${finding.title || ''}\n\n${finding.comment || ''}`;
  if (finding.suggestion) {
    body += `\n\n\`\`\`suggestion\n${finding.suggestion}\n\`\`\``;
  }
  if (finding.reference) {
    body += `\n\n📚 [Reference](${finding.reference})`;
  }
  return body.trim();
}

function summarize(findings, unanchored) {
  const counts = { High: 0, Medium: 0, Low: 0 };
  for (const f of findings) {
    if (counts[f.priority] !== undefined) counts[f.priority] += 1;
  }
  let body = `## 🤖 Jules AI Code Review\n\n`;
  body += `Found **${findings.length}** finding(s): 🔴 ${counts.High} High, 🟡 ${counts.Medium} Medium, 🟢 ${counts.Low} Low.\n`;

  if (unanchored.length > 0) {
    body += `\n### Additional findings (outside the diff range)\n\n`;
    for (const f of unanchored) {
      const badge = PRIORITY_BADGE[f.priority] || `**[${f.priority || 'Unknown'}]**`;
      body += `- ${badge} \`${f.path}:${f.line}\` — ${f.title || ''}\n  ${f.comment || ''}\n`;
    }
  }
  return body;
}

async function postReview({ findings, unanchored, rawFallback }) {
  if (findings === null) {
    const body =
      `## 🤖 Jules AI Code Review\n\n` +
      `Jules finished the review but the response could not be parsed as structured findings. Raw output:\n\n` +
      `<details><summary>Show output</summary>\n\n\`\`\`\n${(rawFallback || '').slice(0, 60000)}\n\`\`\`\n\n</details>`;
    await githubFetch(`/repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    return;
  }

  if (findings.length === 0 && unanchored.length === 0) {
    await githubFetch(`/repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        body: '## 🤖 Jules AI Code Review\n\nNo issues found in this diff. 🎉',
      }),
    });
    return;
  }

  const comments = findings.map((f) => ({
    path: f.path,
    line: f.line,
    side: 'RIGHT',
    body: formatCommentBody(f),
  }));

  await githubFetch(`/repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/reviews`, {
    method: 'POST',
    body: JSON.stringify({
      commit_id: PR_HEAD_SHA,
      event: 'COMMENT',
      body: summarize(findings, unanchored),
      comments,
    }),
  });
}

async function main() {
  const diff = fs.readFileSync(DIFF_FILE, 'utf8');
  if (!diff.trim()) {
    console.log('Empty diff, skipping review.');
    return;
  }

  console.log('Looking up Jules source for repo...');
  const source = await findSource();
  if (!source) {
    console.error(
      `No Jules source found for ${OWNER}/${REPO}. Connect this repository at https://jules.google before this workflow can run.`
    );
    process.exit(1);
  }

  console.log('Creating Jules session...');
  const session = await createSession(source, diff);
  console.log(`Session created: ${session.name}`);

  console.log('Waiting for Jules to finish reviewing...');
  const { status, messages } = await waitForCompletion(session.name);

  if (status === 'TIMEOUT') {
    console.error('Timed out waiting for Jules session to complete.');
    process.exit(1);
  }
  if (status === 'FAILED') {
    console.error('Jules session failed.');
    process.exit(1);
  }
  if (messages.length === 0) {
    console.log('Jules returned no messages; nothing to post.');
    return;
  }

  const { findings, raw } = extractFindings(messages);
  if (findings === null) {
    console.warn('Could not parse findings as JSON; posting raw output as fallback.');
    await postReview({ findings: null, unanchored: [], rawFallback: raw });
    return;
  }

  const commentable = buildCommentableLines(diff);
  const anchored = [];
  const unanchored = [];
  for (const f of findings) {
    const lines = commentable.get(f.path);
    if (lines && lines.has(f.line)) {
      anchored.push(f);
    } else {
      unanchored.push(f);
    }
  }

  console.log(
    `Posting review: ${anchored.length} inline comment(s), ${unanchored.length} summarized finding(s).`
  );
  await postReview({ findings: anchored, unanchored, rawFallback: raw });
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
