// v19.0 Frontend Features - Document Chat, AI Agents, Templates, Vision, Prompts, Analytics
const API19='';

// Document Chat
async function uploadDocument(file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch(API19+'/api/docs/upload', {method:'POST', headers:{'Authorization':'***'+getToken()}, body:fd});
  if (r.ok) { const d = await r.json(); showToast('Document uploaded: '+d.doc.name); return d.doc; }
  showToast('Upload failed', 'err');
}

function showDocChatModal() {
  showModal('<h2>Chat with Document</h2><p style="font-size:.82rem;color:var(--ink3);margin-bottom:16px">Upload a PDF or document and ask questions about it.</p><div class="fg"><input type="file" id="docFile" accept=".pdf,.doc,.docx,.txt" class="input" style="padding:8px"></div><button class="btn" onclick="handleDocUpload()" style="width:100%">Upload & Chat</button><div id="docList" style="margin-top:16px"></div>');
  loadDocs();
}

async function loadDocs() {
  try {
    const r = await fetch(API19+'/api/docs', {headers:{'Authorization':'***'+getToken()}});
    if (r.ok) {
      const d = await r.json();
      const el = document.getElementById('docList');
      if (el && d.docs) el.innerHTML = d.docs.map(doc => '<div style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;cursor:pointer" onclick="startDocChat(\''+doc.id+'\')"><svg width="16" height="16"><use href="#icon-document"/></svg><div style="flex:1"><strong style="font-size:.82rem">'+doc.name+'</strong><div style="font-size:.7rem;color:var(--ink4)">'+doc.pages+' pages</div></div><button onclick="event.stopPropagation();deleteDoc(\''+doc.id+'\')" style="background:none;border:none;color:var(--ink4);cursor:pointer"><svg width="14" height="14"><use href="#icon-trash"/></svg></button></div>').join('') || '<div style="color:var(--ink4);text-align:center;font-size:.8rem">No documents yet</div>';
    }
  } catch {}
}

async function handleDocUpload() {
  const input = document.getElementById('docFile');
  if (input.files[0]) await uploadDocument(input.files[0]);
  loadDocs();
}

async function deleteDoc(id) {
  await fetch(API19+'/api/docs/'+id, {method:'DELETE', headers:{'Authorization':'***'+getToken()}});
  loadDocs();
}

function startDocChat(docId) {
  closeModal();
  currentChatId = null;
  chatMessages = [];
  renderMessages();
  showToast('Document loaded — ask me anything about it');
}

// AI Agents
let userAgents = [];
async function loadAgents() {
  try {
    const r = await fetch(API19+'/api/agents', {headers:{'Authorization':'***'+getToken()}});
    if (r.ok) { const d = await r.json(); userAgents = d.agents || []; }
  } catch {}
}

function showAgentsModal() {
  loadAgents();
  showModal('<h2>AI Agents</h2><p style="font-size:.82rem;color:var(--ink3);margin-bottom:16px">Create custom AI personas with specific instructions.</p><div id="agentList" style="margin-bottom:16px;max-height:200px;overflow-y:auto"></div><div class="fg"><input class="input" id="agentName" placeholder="Agent name"></div><div class="fg"><textarea class="input" id="agentInstructions" rows="3" placeholder="Custom instructions for this agent..."></textarea></div><div class="fg"><select class="input" id="agentModel"><option value="claude-sonnet-4">Claude Sonnet 4</option><option value="gpt-4o">GPT-4o</option><option value="llama-3.3-70b">Llama 3.3 70B</option></select></div><button class="btn" onclick="createAgent()" style="width:100%">Create Agent</button>');
  renderAgentList();
}

function renderAgentList() {
  const el = document.getElementById('agentList');
  if (!el) return;
  el.innerHTML = userAgents.map(a => '<div style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px"><svg width="16" height="16"><use href="#icon-brain"/></svg><div style="flex:1"><strong style="font-size:.82rem">'+a.name+'</strong><div style="font-size:.7rem;color:var(--ink4)">'+a.model+'</div></div><button onclick="useAgent(\''+a.id+'\')" style="background:var(--accent);color:#fff;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:.72rem">Use</button><button onclick="deleteAgent(\''+a.id+'\')" style="background:none;border:none;color:var(--ink4);cursor:pointer"><svg width="14" height="14"><use href="#icon-trash"/></svg></button></div>').join('') || '<div style="color:var(--ink4);text-align:center;font-size:.8rem">No agents yet — create one below</div>';
}

async function createAgent() {
  const name = document.getElementById('agentName').value;
  const instructions = document.getElementById('agentInstructions').value;
  const model = document.getElementById('agentModel').value;
  if (!name || !instructions) return;
  await fetch(API19+'/api/agents', {method:'POST', headers:{'Content-Type':'application/json','Authorization':'***'+getToken()}, body:JSON.stringify({name,instructions,model})});
  loadAgents();
  renderAgentList();
  document.getElementById('agentName').value = '';
  document.getElementById('agentInstructions').value = '';
  showToast('Agent created');
}

async function deleteAgent(id) {
  await fetch(API19+'/api/agents/'+id, {method:'DELETE', headers:{'Authorization':'***'+getToken()}});
  loadAgents();
  renderAgentList();
}

function useAgent(id) {
  const agent = userAgents.find(a => a.id === id);
  if (agent) {
    customInstructions = agent.instructions;
    closeModal();
    showToast('Agent "'+agent.name+'" activated');
  }
}

// Templates
function showTemplatesModal() {
  fetch(API19+'/api/templates').then(r=>r.json()).then(d=>{
    showModal('<h2>Chat Templates</h2><p style="font-size:.82rem;color:var(--ink3);margin-bottom:16px">Pre-built prompt chains for common tasks.</p><div style="display:grid;gap:8px">'+d.templates.map(t=>'<div style="padding:10px;border:1px solid var(--border);border-radius:6px;cursor:pointer" onclick="useTemplate(\''+t.id+'\')"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><strong style="font-size:.84rem">'+t.name+'</strong><span style="font-size:.7rem;color:var(--accent)">'+t.category+'</span></div><div style="font-size:.78rem;color:var(--ink3)">'+t.desc+'</div></div>').join('')+'</div>');
  });
}

async function useTemplate(id) {
  const r = await fetch(API19+'/api/templates/use', {method:'POST', headers:{'Content-Type':'application/json','Authorization':'***'+getToken()}, body:JSON.stringify({templateId:id})});
  if (r.ok) {
    const d = await r.json();
    document.getElementById('messageInput').value = d.prompt;
    closeModal();
  }
}

// Prompt Library
function showPromptLibrary() {
  fetch(API19+'/api/prompts').then(r=>r.json()).then(d=>{
    const categories = [...new Set(d.prompts.map(p=>p.category))];
    showModal('<h2>Prompt Library</h2><p style="font-size:.82rem;color:var(--ink3);margin-bottom:16px">Ready-to-use prompts for any task.</p>'+categories.map(cat=>'<div style="margin-bottom:12px"><div style="font-size:.72rem;font-weight:600;color:var(--accent);text-transform:uppercase;margin-bottom:6px">'+cat+'</div>'+d.prompts.filter(p=>p.category===cat).map(p=>'<div style="padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:4px;cursor:pointer;font-size:.82rem" onclick="usePrompt(\''+p.prompt.replace(/'/g,"\\'")+'\')">'+p.name+'</div>').join('')+'</div>').join(''));
  });
}

function usePrompt(prompt) {
  document.getElementById('messageInput').value = prompt;
  closeModal();
}

// Quick Actions
function showQuickActions() {
  fetch(API19+'/api/quick-actions').then(r=>r.json()).then(d=>{
    showModal('<h2>Quick Actions</h2><p style="font-size:.82rem;color:var(--ink3);margin-bottom:16px">One-click AI transformations.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+d.actions.map(a=>'<div style="padding:12px;border:1px solid var(--border);border-radius:6px;cursor:pointer;text-align:center" onclick="useQuickAction(\''+a.prompt.replace(/'/g,"\\'")+'\')"><svg width="20" height="20" style="margin-bottom:4px;color:var(--accent)"><use href="#icon-'+a.icon+'"/></svg><div style="font-size:.8rem;font-weight:500">'+a.name+'</div></div>').join('')+'</div>');
  });
}

function useQuickAction(prompt) {
  document.getElementById('messageInput').value = prompt;
  closeModal();
}

// Detailed Analytics
function showDetailedAnalytics() {
  fetch(API19+'/api/analytics/detailed', {headers:{'Authorization':'***'+getToken()}}).then(r=>r.json()).then(d=>{
    showModal('<h2>Your Analytics</h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0"><div style="padding:12px;border:1px solid var(--border);border-radius:6px;text-align:center"><div style="font-size:1.4rem;font-weight:700;color:var(--accent)">'+d.totalChats+'</div><div style="font-size:.72rem;color:var(--ink4)">Total Chats</div></div><div style="padding:12px;border:1px solid var(--border);border-radius:6px;text-align:center"><div style="font-size:1.4rem;font-weight:700;color:var(--accent)">'+d.totalMessages+'</div><div style="font-size:.72rem;color:var(--ink4)">Messages</div></div><div style="padding:12px;border:1px solid var(--border);border-radius:6px;text-align:center"><div style="font-size:1.4rem;font-weight:700;color:var(--accent)">'+d.avgMessagesPerChat+'</div><div style="font-size:.72rem;color:var(--ink4)">Avg per Chat</div></div><div style="padding:12px;border:1px solid var(--border);border-radius:6px;text-align:center"><div style="font-size:1.4rem;font-weight:700;color:var(--accent)">'+Object.keys(d.modelUsage).length+'</div><div style="font-size:.72rem;color:var(--ink4)">Models Used</div></div></div><button class="btn" onclick="closeModal()" style="width:100%">Close</button>');
  });
}

// Keyboard Shortcuts Modal
function showShortcutsModal() {
  fetch(API19+'/api/shortcuts').then(r=>r.json()).then(d=>{
    showModal('<h2>Keyboard Shortcuts</h2><div style="margin-top:12px">'+d.shortcuts.map(s=>'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span style="font-size:.82rem">'+s.action+'</span><kbd style="background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:.72rem;font-family:monospace">'+s.keys+'</kbd></div>').join('')+'</div><button class="btn" onclick="closeModal()" style="width:100%;margin-top:16px">Close</button>');
  });
}

// Conversation Summary
async function summarizeChat() {
  if (!currentChatId) return showToast('Open a chat first', 'err');
  const r = await fetch(API19+'/api/chats/'+currentChatId+'/summarize', {headers:{'Authorization':'***'+getToken()}});
  if (r.ok) {
    const d = await r.json();
    showModal('<h2>Chat Summary</h2><div style="margin:12px 0"><div style="display:flex;gap:12px;margin-bottom:12px"><div style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;text-align:center;flex:1"><div style="font-size:1.1rem;font-weight:700">'+d.summary.totalMessages+'</div><div style="font-size:.7rem;color:var(--ink4)">Messages</div></div><div style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;text-align:center;flex:1"><div style="font-size:1.1rem;font-weight:700">'+d.summary.userMessages+'</div><div style="font-size:.7rem;color:var(--ink4)">Your msgs</div></div><div style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;text-align:center;flex:1"><div style="font-size:1.1rem;font-weight:700">'+d.summary.aiMessages+'</div><div style="font-size:.7rem;color:var(--ink4)">AI msgs</div></div></div>'+(d.summary.keyPoints.length?'<div style="font-size:.78rem;font-weight:600;margin-bottom:6px">Recent Topics:</div>'+d.summary.keyPoints.map(k=>'<div style="font-size:.8rem;color:var(--ink3);padding:4px 0;border-bottom:1px solid var(--border)">• '+k+'</div>').join(''):'')+'</div><button class="btn" onclick="closeModal()" style="width:100%">Close</button>');
  }
}

console.log('[Tribal AI v19.0] Frontend loaded: doc-chat, agents, templates, prompts, quick-actions, analytics, shortcuts, summarize');
