'use strict';

const fs = require('node:fs');

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_DIFF_CHARS = 100_000;

const {
  GEMINI_API_KEY,
  GEMINI_MODEL,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  PR_NUMBER,
  PR_HEAD_SHA,
  DIFF_FILE,
} = process.env;

const MODEL = GEMINI_MODEL || 'gemini-2.5-pro';

function requireEnv(name, value) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

requireEnv('GEMINI_API_KEY', GEMINI_API_KEY);
requireEnv('GITHUB_TOKEN', GITHUB_TOKEN);
requireEnv('GITHUB_REPOSITORY', GITHUB_REPOSITORY);
requireEnv('PR_NUMBER', PR_NUMBER);
requireEnv('PR_HEAD_SHA', PR_HEAD_SHA);
requireEnv('DIFF_FILE', DIFF_FILE);

const [OWNER, REPO] = GITHUB_REPOSITORY.split('/');

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

function buildPrompt(diff) {
  const truncated = diff.length > MAX_DIFF_CHARS;
  const diffSnippet = truncated ? diff.slice(0, MAX_DIFF_CHARS) : diff;

  return `You are a senior code reviewer. Review ONLY the unified diff below from a pull request. Do not propose modifying the diff itself — provide analysis only.

Focus areas:
- SOLID and KISS principles
- Readable, well-structured, maintainable code
- Common security vulnerabilities (injection, unsafe input handling, secrets, auth/JWT issues, etc.)

For each issue you find:
- Only reference lines that appear as added or unchanged context lines (lines starting with "+" or " ", never lines starting with "-") in the diff below, using the file path and the NEW file line number shown in the diff hunk headers.
- Write a clear, constructive comment explaining what to improve and how.
- Include a short example of the better practice in "suggestion" when relevant.
- Include a "reference" URL to relevant documentation when useful.
- Classify the finding's priority as "High", "Medium", or "Low".
- If there are no issues, return an empty array.

${truncated ? 'NOTE: the diff was truncated due to size; review what is shown.\n\n' : ''}Diff:
\`\`\`diff
${diffSnippet}
\`\`\`
`;
}

const FINDING_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      path: { type: 'STRING' },
      line: { type: 'INTEGER' },
      priority: { type: 'STRING', enum: ['High', 'Medium', 'Low'] },
      title: { type: 'STRING' },
      comment: { type: 'STRING' },
      suggestion: { type: 'STRING' },
      reference: { type: 'STRING' },
    },
    required: ['path', 'line', 'priority', 'title', 'comment'],
  },
};

async function reviewWithGemini(diff) {
  const res = await fetch(
    `${GEMINI_API}/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(diff) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: FINDING_SCHEMA,
          temperature: 0.2,
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API request failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  const candidate = data.candidates && data.candidates[0];
  const text =
    candidate &&
    candidate.content &&
    candidate.content.parts &&
    candidate.content.parts.map((p) => p.text || '').join('');

  if (!text) {
    return { findings: null, raw: JSON.stringify(data) };
  }

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { findings: parsed, raw: text };
    return { findings: null, raw: text };
  } catch {
    return { findings: null, raw: text };
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
  let body = `## 🤖 Gemini AI Code Review\n\n`;
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
      `## 🤖 Gemini AI Code Review\n\n` +
      `Gemini responded but the output could not be parsed as structured findings. Raw output:\n\n` +
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
        body: '## 🤖 Gemini AI Code Review\n\nNo issues found in this diff. 🎉',
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

  console.log(`Requesting review from Gemini (${MODEL})...`);
  const { findings, raw } = await reviewWithGemini(diff);

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
