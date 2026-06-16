#!/usr/bin/env node
/**
 * setup-youtrack-project.js
 *
 * Creates a YouTrack project configured for AgentOS:
 *   - Project:      AGT (AgentOS)
 *   - State Bundle: 6 states matching the AgentOS workflow
 *   - Agile Board:  one board per project, sprint-based
 *   - Sprint 1:     ready to receive Wave 1 tasks
 *
 * Usage:
 *   node scripts/setup-youtrack-project.js
 *   node scripts/setup-youtrack-project.js --project-id AGT --project-name "AgentOS"
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const https = require('https');
const http  = require('http');
const url   = require('url');

const BASE_URL = (process.env.YOUTRACK_URL || '').replace(/\/$/, '');
const TOKEN    = process.env.YOUTRACK_TOKEN || '';

if (!BASE_URL || !TOKEN) {
  console.error('[FAIL] YOUTRACK_URL and YOUTRACK_TOKEN must be set in .env');
  process.exit(1);
}

// ---- CLI args ----
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const PROJECT_ID   = getArg('--project-id',   'AGT');
const PROJECT_NAME = getArg('--project-name', 'AgentOS');
const SPRINT_NAME  = getArg('--sprint',       'Wave 1');

// ---- HTTP helper ----
function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(BASE_URL + path);
    const isHttps = parsed.protocol === 'https:';
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.path,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    };
    const transport = isHttps ? https : http;
    const reqObj = transport.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} ${method} ${path}: ${data.slice(0, 300)}`));
        } else {
          try { resolve(data ? JSON.parse(data) : {}); }
          catch { resolve(data); }
        }
      });
    });
    reqObj.on('error', reject);
    if (body) reqObj.write(JSON.stringify(body));
    reqObj.end();
  });
}

function get(path)         { return req('GET',    path, null); }
function post(path, body)  { return req('POST',   path, body); }
function patch(path, body) { return req('POST',   path, body); } // YT uses POST for updates too

// ---- AgentOS state definitions ----
const STATES = [
  { name: 'Open',          isInitial: true,  isResolved: false, category: 'TO_DO'       },
  { name: 'In Progress',   isInitial: false, isResolved: false, category: 'IN_PROGRESS' },
  { name: 'Needs QA',      isInitial: false, isResolved: false, category: 'IN_PROGRESS' },
  { name: 'Needs Review',  isInitial: false, isResolved: false, category: 'IN_PROGRESS' },
  { name: 'Needs Fix',     isInitial: false, isResolved: false, category: 'IN_PROGRESS' },
  { name: 'Fixed',         isInitial: false, isResolved: true,  category: 'DONE'        }
];

// ---- Steps ----

async function step1_ensureProject() {
  console.log(`\n[1/5] Project: ${PROJECT_ID} — ${PROJECT_NAME}`);

  // Check if project exists
  try {
    const existing = await get(
      `/api/admin/projects?fields=id,shortName,name&query=${encodeURIComponent(PROJECT_ID)}`
    );
    const found = (existing || []).find(p => p.shortName === PROJECT_ID);
    if (found) {
      console.log(`      already exists (id=${found.id})`);
      return found.id;
    }
  } catch {}

  // Get current user to set as project lead
  let leadId = null;
  try {
    const me = await get('/api/users/me?fields=id,login');
    leadId = me.id;
    console.log(`      lead: ${me.login}`);
  } catch {}

  const body = {
    shortName: PROJECT_ID,
    name: PROJECT_NAME,
    leader: leadId ? { id: leadId } : undefined
  };

  const created = await post('/api/admin/projects?fields=id,shortName,name', body);
  console.log(`      created (id=${created.id})`);
  return created.id;
}

async function step2_createStateBundle() {
  console.log(`\n[2/5] State Bundle: "AgentOS Workflow"`);

  // Check if bundle already exists
  try {
    const bundles = await get(
      '/api/admin/customFieldSettings/bundles/state?fields=id,name&$top=100'
    );
    const found = (bundles || []).find(b => b.name === 'AgentOS Workflow');
    if (found) {
      console.log(`      already exists (id=${found.id})`);
      return found.id;
    }
  } catch {}

  // Create bundle
  const bundle = await post(
    '/api/admin/customFieldSettings/bundles/state?fields=id,name',
    { name: 'AgentOS Workflow', values: [] }
  );
  console.log(`      bundle created (id=${bundle.id})`);

  // Add states
  for (const s of STATES) {
    try {
      await post(
        `/api/admin/customFieldSettings/bundles/state/${bundle.id}/values?fields=id,name`,
        {
          $type: 'StateBundleElement',
          name: s.name,
          isInitial: s.isInitial,
          isResolved: s.isResolved,
          localizedName: s.name
        }
      );
      console.log(`      + ${s.name}`);
    } catch (e) {
      console.warn(`      [WARN] ${s.name}: ${e.message.slice(0, 80)}`);
    }
  }

  return bundle.id;
}

async function step3_attachBundleToProject(projectId, bundleId) {
  console.log(`\n[3/5] Attach State bundle to project`);

  // List current project custom fields
  let stateFieldId = null;
  try {
    const fields = await get(
      `/api/admin/projects/${projectId}/customFields?fields=id,field(id,name,fieldType(id))&$top=50`
    );
    const stateField = (fields || []).find(
      f => f.field && f.field.name === 'State'
    );
    if (stateField) {
      stateFieldId = stateField.id;
      console.log(`      State field already attached (id=${stateFieldId})`);
    }
  } catch {}

  if (stateFieldId) {
    // Update the bundle on existing State field
    try {
      await req('POST',
        `/api/admin/projects/${projectId}/customFields/${stateFieldId}?fields=id`,
        { bundle: { id: bundleId } }
      );
      console.log(`      bundle updated on existing State field`);
    } catch (e) {
      console.warn(`      [WARN] could not update bundle: ${e.message.slice(0, 120)}`);
    }
    return;
  }

  // Find the global State custom field definition
  let globalFieldId = null;
  try {
    const globalFields = await get(
      '/api/admin/customFieldSettings/customFields?fields=id,name,fieldType(id)&$top=100'
    );
    const sf = (globalFields || []).find(f => f.name === 'State');
    if (sf) globalFieldId = sf.id;
  } catch {}

  if (!globalFieldId) {
    console.warn('      [WARN] global State field not found — skipping bundle attach');
    return;
  }

  try {
    await post(
      `/api/admin/projects/${projectId}/customFields?fields=id`,
      {
        $type: 'StateProjectCustomField',
        field: { id: globalFieldId },
        bundle: { id: bundleId },
        defaultValues: [{ name: 'Open' }]
      }
    );
    console.log(`      State field attached with bundle`);
  } catch (e) {
    console.warn(`      [WARN] attach failed: ${e.message.slice(0, 150)}`);
  }
}

async function step4_createAgileBoard(projectId) {
  console.log(`\n[4/5] Agile Board: "${PROJECT_NAME} Board"`);

  const boardName = `${PROJECT_NAME} Board`;

  // Check if board exists
  try {
    const boards = await get('/api/agiles?fields=id,name,projects(id)&$top=100');
    const found = (boards || []).find(b => b.name === boardName);
    if (found) {
      console.log(`      already exists (id=${found.id})`);
      return found.id;
    }
  } catch {}

  const body = {
    name: boardName,
    projects: [{ id: projectId }],
    columnSettings: {
      columns: STATES.map(s => ({
        presentation: s.name,
        values: [{ name: s.name }]
      }))
    },
    sprintsSettings: {
      disableSprints: false,
      isExplicit: true
    }
  };

  try {
    const board = await post('/api/agiles?fields=id,name', body);
    console.log(`      created (id=${board.id})`);
    return board.id;
  } catch (e) {
    // Some YT instances require simpler board creation
    console.warn(`      [WARN] full board create failed: ${e.message.slice(0, 100)}`);
    try {
      const simple = await post('/api/agiles?fields=id,name', {
        name: boardName,
        projects: [{ id: projectId }]
      });
      console.log(`      created simple board (id=${simple.id})`);
      return simple.id;
    } catch (e2) {
      console.warn(`      [WARN] board creation skipped: ${e2.message.slice(0, 100)}`);
      return null;
    }
  }
}

async function step5_createSprint(boardId) {
  console.log(`\n[5/5] Sprint: "${SPRINT_NAME}"`);

  if (!boardId) {
    console.warn('      [SKIP] no board id');
    return null;
  }

  // Check if sprint exists
  try {
    const sprints = await get(`/api/agiles/${boardId}/sprints?fields=id,name&$top=50`);
    const found = (sprints || []).find(s => s.name === SPRINT_NAME);
    if (found) {
      console.log(`      already exists (id=${found.id})`);
      return found.id;
    }
  } catch {}

  try {
    const sprint = await post(
      `/api/agiles/${boardId}/sprints?fields=id,name`,
      { name: SPRINT_NAME, goal: 'AgentOS Wave 1 — initial pipeline' }
    );
    console.log(`      created (id=${sprint.id})`);
    return sprint.id;
  } catch (e) {
    console.warn(`      [WARN] sprint create failed: ${e.message.slice(0, 100)}`);
    return null;
  }
}

async function printSummary(projectId, bundleId, boardId, sprintId) {
  console.log('\n===========================================');
  console.log(' AgentOS YouTrack Setup — Done');
  console.log('===========================================');
  console.log(` Project:    ${PROJECT_ID} — ${PROJECT_NAME}`);
  console.log(` Project ID: ${projectId}`);
  console.log(` Bundle ID:  ${bundleId || '(skipped)'}`);
  console.log(` Board ID:   ${boardId  || '(skipped)'}`);
  console.log(` Sprint ID:  ${sprintId || '(skipped)'}`);
  console.log('');
  console.log(' Workflow states:');
  STATES.forEach(s => console.log(`   ${s.isInitial ? '->' : '  '} ${s.name}${s.isResolved ? ' [resolved]' : ''}`));
  console.log('');
  console.log(' Next steps:');
  console.log(`   1. Add to .env:  YOUTRACK_PROJECT=${PROJECT_ID}`);
  console.log(`   2. Restart server: node server/index.js`);
  console.log(`   3. Open board: ${BASE_URL}/agiles`);
  console.log('===========================================\n');
}

// ---- Main ----
(async () => {
  console.log('===========================================');
  console.log(' AgentOS YouTrack Setup');
  console.log(`  URL:     ${BASE_URL}`);
  console.log(`  Project: ${PROJECT_ID} — ${PROJECT_NAME}`);
  console.log(`  Sprint:  ${SPRINT_NAME}`);
  console.log('===========================================');

  try {
    const projectId = await step1_ensureProject();
    const bundleId  = await step2_createStateBundle();
    await step3_attachBundleToProject(projectId, bundleId);
    const boardId   = await step4_createAgileBoard(projectId);
    const sprintId  = await step5_createSprint(boardId);
    await printSummary(projectId, bundleId, boardId, sprintId);
  } catch (e) {
    console.error('\n[FAIL]', e.message);
    process.exit(1);
  }
})();
