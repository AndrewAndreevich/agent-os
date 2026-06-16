// Real YouTrack REST API client (API v3).
//
// This instance (libraryabout.youtrack.cloud / project PVF) does NOT expose
// the /issues/{id}/transitions subresource (it 404s). State changes are made
// by writing the "State" custom field directly with a StateBundleElement
// value — exactly how the project's own yt.py CLI does it.
//
// Custom fields that exist on PVF: Priority, Type, State, Subsystem,
// Assignee, Estimation, Spent time, Calendar Time, Agent Role (string),
// Tokens Used (integer), Timer time. The AgentOS QA fields
// (qa_check_type / qa_artifact_path / qa_expected_output) do NOT exist, so
// updateCustomField falls back to appending to the issue description.
//
// Every method is wrapped in try/catch, logs with a [YouTrack] prefix, and
// returns null on failure instead of throwing.

function cfg() {
  return {
    url: (process.env.YOUTRACK_URL || '').replace(/\/$/, ''),
    token: process.env.YOUTRACK_TOKEN || '',
    project: process.env.YOUTRACK_PROJECT || ''
  };
}

function headers() {
  return {
    Authorization: `Bearer ${cfg().token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
}

async function api(method, path, body) {
  const { url } = cfg();
  if (!url) throw new Error('YOUTRACK_URL not configured');
  const res = await fetch(`${url}/api/${path}`, {
    method,
    headers: headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status} on ${method} ${path}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// Cache the internal project id (admin/projects returns id for a shortName).
let _projectIdCache = null;
async function getProjectId() {
  if (_projectIdCache) return _projectIdCache;
  const { project } = cfg();
  const projects = await api('GET', 'admin/projects?fields=id,shortName');
  const match = projects.find((p) => p.shortName === project);
  if (!match) throw new Error(`project ${project} not found`);
  _projectIdCache = match.id;
  return _projectIdCache;
}

const ISSUE_FIELDS =
  'id,idReadable,summary,description,customFields(id,name,$type,value(id,name,text)),created';

// Normalize a raw YouTrack issue so callers can read either `customFields`
// (native) or `fields` (the webhook-style alias used by some tests).
function normalizeIssue(raw) {
  if (!raw || !raw.id) return raw;
  raw.fields = (raw.customFields || []).map((f) => ({ name: f.name, value: f.value }));
  return raw;
}

// --- getIssue -------------------------------------------------------------
async function getIssue(issueId) {
  try {
    const issue = await api('GET', `issues/${issueId}?fields=${ISSUE_FIELDS}`);
    return normalizeIssue(issue);
  } catch (e) {
    console.error('[YouTrack] getIssue failed:', e.message);
    return null;
  }
}

// --- transitionIssue ------------------------------------------------------
// transitionName here is the TARGET state name (e.g. "In Progress").
// We set the State custom field directly because this instance has no
// /transitions subresource.
async function transitionIssue(issueId, transitionName) {
  try {
    const issue = await api(
      'GET',
      `issues/${issueId}?fields=customFields(id,name,$type,value(name))`
    );
    const stateField = (issue.customFields || []).find((f) => f.name === 'State');
    if (!stateField) {
      console.warn(`[YouTrack] transitionIssue: no State field on ${issueId}`);
      return null;
    }

    // Resolve the canonical state name (case-insensitive) from the bundle.
    let target = transitionName;
    try {
      const pid = await getProjectId();
      const data = await api(
        'GET',
        `admin/projects/${pid}/customFields?fields=field(name),bundle(values(name))`
      );
      const sf = data.find((f) => f.field && f.field.name === 'State');
      const values = (sf && sf.bundle && sf.bundle.values) || [];
      const found = values.find(
        (v) => v.name.toLowerCase() === String(transitionName).toLowerCase()
      );
      if (found) target = found.name;
      else
        console.warn(
          `[YouTrack] transitionIssue: state "${transitionName}" not in bundle; sending as-is`
        );
    } catch (inner) {
      console.warn('[YouTrack] transitionIssue: bundle lookup failed:', inner.message);
    }

    const result = await api('POST', `issues/${issueId}?fields=id`, {
      customFields: [
        {
          $type: stateField.$type,
          id: stateField.id,
          value: { $type: 'StateBundleElement', name: target }
        }
      ]
    });
    return result;
  } catch (e) {
    console.warn(`[YouTrack] transitionIssue(${issueId} -> ${transitionName}) failed:`, e.message);
    return null;
  }
}

// --- addComment -----------------------------------------------------------
async function addComment(issueId, text) {
  try {
    return await api('POST', `issues/${issueId}/comments?fields=id,text`, { text });
  } catch (e) {
    console.error('[YouTrack] addComment failed:', e.message);
    return null;
  }
}

// --- addWorklog -----------------------------------------------------------
async function addWorklog(issueId, agentId, durationMinutes, description) {
  const path = `issues/${issueId}/timeTracking/workItems?fields=id,duration(minutes)`;
  const base = { duration: { minutes: durationMinutes }, text: description };
  try {
    // First try with the author login as specified.
    return await api('POST', path, { ...base, author: { login: agentId } });
  } catch (e1) {
    // The agent login may not exist as a YouTrack user; retry without author.
    console.warn('[YouTrack] addWorklog with author failed, retrying without:', e1.message);
    try {
      return await api('POST', path, base);
    } catch (e2) {
      console.warn(
        '[YouTrack] addWorklog failed (time tracking may be disabled):',
        e2.message
      );
      return null;
    }
  }
}

// --- updateCustomField ----------------------------------------------------
async function updateCustomField(issueId, fieldName, value) {
  try {
    const issue = await api(
      'GET',
      `issues/${issueId}?fields=description,customFields(id,name,$type,value(id,name))`
    );
    const field = (issue.customFields || []).find((f) => f.name === fieldName);

    if (field) {
      const body = buildFieldBody(field, value);
      if (body) {
        return await api('POST', `issues/${issueId}?fields=id`, {
          customFields: [body]
        });
      }
    }

    // Field doesn't exist (or unsupported type): append to the description.
    const prev = issue.description || '';
    const line = `\n\n**${fieldName}:** ${value}`;
    const updated = await api('POST', `issues/${issueId}?fields=id,description`, {
      description: prev + line
    });
    console.warn(
      `[YouTrack] updateCustomField: "${fieldName}" not a settable field; appended to description`
    );
    return updated;
  } catch (e) {
    console.error('[YouTrack] updateCustomField failed:', e.message);
    return null;
  }
}

function buildFieldBody(field, value) {
  const { id, $type } = field;
  switch ($type) {
    case 'TextIssueCustomField':
      return { $type, id, value: { text: String(value) } };
    case 'SingleEnumIssueCustomField':
      return { $type, id, value: { name: String(value) } };
    case 'StateIssueCustomField':
      return { $type, id, value: { $type: 'StateBundleElement', name: String(value) } };
    case 'SimpleIssueCustomField': {
      // integer / string simple fields take the raw value.
      const num = Number(value);
      return { $type, id, value: Number.isNaN(num) ? String(value) : num };
    }
    default:
      // Unknown field type — signal caller to fall back to description.
      return null;
  }
}

// --- getSprintIssues ------------------------------------------------------
async function getSprintIssues(sprintId) {
  try {
    const agiles = await api('GET', 'agiles?fields=id,name,sprints(id,name)');
    let boardId = null;
    let resolvedSprint = null;
    for (const board of agiles) {
      for (const sprint of board.sprints || []) {
        if (sprint.id === sprintId || sprint.name === sprintId) {
          boardId = board.id;
          resolvedSprint = sprint.id;
          break;
        }
      }
      if (boardId) break;
    }
    if (!boardId) {
      console.warn(`[YouTrack] getSprintIssues: sprint ${sprintId} not found`);
      return null;
    }
    return await api(
      'GET',
      `agiles/${boardId}/sprints/${resolvedSprint}/issues?fields=id,idReadable,summary,customFields(name,value(name))`
    );
  } catch (e) {
    console.error('[YouTrack] getSprintIssues failed:', e.message);
    return null;
  }
}

// --- createIssue ----------------------------------------------------------
async function createIssue(
  summary,
  description,
  requiredCapabilities,
  qaCheckType,
  qaArtifactPath,
  qaExpectedOutput
) {
  try {
    const projectId = await getProjectId();

    // The QA metadata has no dedicated custom fields on PVF, so embed it in
    // the description where the dev/QA agents can read it.
    const meta = [
      description || '',
      '',
      '---',
      `required_capabilities: ${JSON.stringify(requiredCapabilities || [])}`,
      `qa_check_type: ${qaCheckType || ''}`,
      `qa_artifact_path: ${qaArtifactPath || ''}`,
      `qa_expected_output: ${qaExpectedOutput || ''}`
    ].join('\n');

    const issue = await api('POST', 'issues?fields=id,idReadable,summary', {
      project: { id: projectId },
      summary,
      description: meta
    });

    const issueId = issue.idReadable || issue.id;
    return issueId;
  } catch (e) {
    console.error('[YouTrack] createIssue failed:', e.message);
    return null;
  }
}

module.exports = {
  getIssue,
  transitionIssue,
  addComment,
  addWorklog,
  updateCustomField,
  getSprintIssues,
  createIssue,
  // exposed for diagnostics / reuse
  _api: api,
  getProjectId
};
