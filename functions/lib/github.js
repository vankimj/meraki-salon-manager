// Minimal GitHub client for the feedback→issue sync. Uses the runtime's global
// fetch (Node 20+). All calls take an explicit token (from the GITHUB_TOKEN
// secret) so nothing is read from the environment implicitly.
//
// Token scope needed: a fine-grained PAT (or classic with `repo` + `project`)
// that can create issues in the repo and add items to the user Project board.

const API = 'https://api.github.com';

function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'plumenexus-feedback-bot',
    'Content-Type': 'application/json',
  };
}

async function ghFetch(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON */ }
  if (!res.ok) {
    const msg = json?.message || text.slice(0, 200) || res.statusText;
    throw new Error(`GitHub ${opts.method || 'GET'} ${res.status}: ${msg}`);
  }
  return json;
}

// Create an issue. Returns { number, url, nodeId }. Missing labels are
// auto-created by GitHub.
async function createIssue({ token, owner, repo, title, body, labels }) {
  const data = await ghFetch(`${API}/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ title, body, labels: labels || [] }),
  });
  return { number: data.number, url: data.html_url, nodeId: data.node_id };
}

// Add an issue (by its GraphQL node id) to a Projects v2 board. Returns the
// project item id. Non-fatal for the caller if it throws — the issue still
// exists; it just isn't carded.
async function addIssueToProject({ token, projectId, contentNodeId }) {
  const query = `mutation($projectId:ID!,$contentId:ID!){
    addProjectV2ItemById(input:{projectId:$projectId,contentId:$contentId}){ item { id } }
  }`;
  const data = await ghFetch(`${API}/graphql`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ query, variables: { projectId, contentId: contentNodeId } }),
  });
  if (data?.errors?.length) throw new Error(`GraphQL: ${data.errors[0].message}`);
  return data?.data?.addProjectV2ItemById?.item?.id || null;
}

// Open/close an issue. stateReason: 'completed' | 'not_planned' | null.
async function setIssueState({ token, owner, repo, number, state, stateReason }) {
  const body = { state };
  if (state === 'closed' && stateReason) body.state_reason = stateReason;
  await ghFetch(`${API}/repos/${owner}/${repo}/issues/${number}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

// Read an issue's state. Returns { state, stateReason }.
async function getIssue({ token, owner, repo, number }) {
  const data = await ghFetch(`${API}/repos/${owner}/${repo}/issues/${number}`, {
    method: 'GET',
    headers: headers(token),
  });
  return { state: data.state, stateReason: data.state_reason || null };
}

module.exports = { createIssue, addIssueToProject, setIssueState, getIssue };
