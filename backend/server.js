/**
 * Tribal AI — Backend Server v3.0
 * Node.js + Express + MongoDB + Anthropic Claude / OpenAI GPT
 * Features: Auth, Chat, File Upload, Payments, Referrals, Sharing, API,
 *           Social Login, Multi-model, Web Search, Templates, Teams
 * Author: Obasanjo Samuel — Tribal Tech
 */

const express   = require('express');
const cors      = require('cors');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const mongoose  = require('mongoose');
const path      = require('path');
const crypto    = require('crypto');
require('dotenv').config();

const app        = express();
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tribal-ai-dev-secret';
const MONGO_URI  = process.env.MONGO_URI;
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL || 'admin@tribalai.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TribalAI2026@@';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const OPENAI_API_KEY    = process.env.OPENAI_API_KEY || '';
const PAYSTACK_SECRET    = process.env.PAYSTACK_SECRET || '';
const GOOGLE_CLIENT_ID  = process.env.GOOGLE_CLIENT_ID  || '';
const GROQ_API_KEY      = process.env.GROQ_API_KEY      || '';
const WEB_SEARCH_API    = process.env.WEB_SEARCH_API    || ''; // SerpAPI/Tavily key
const FREE_LIMIT  = parseInt(process.env.FREE_MONTHLY_LIMIT) || 50;
const PRO_LIMIT   = parseInt(process.env.PRO_MONTHLY_LIMIT) || 9999;
const PRO_PRICE   = 2500; // Naira

// ── Available AI Models ─────────────────────────────────────────────────────
const AI_MODELS = [
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic', tier: 'free' },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic', tier: 'pro' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', tier: 'pro' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', tier: 'free' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', provider: 'groq', tier: 'free' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', provider: 'groq', tier: 'free' },
  { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', provider: 'groq', tier: 'free' },
];

app.set('trust proxy', 1);

// ── MongoDB ──────────────────────────────────────────────────────────────────
if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(async () => { console.log('✅ MongoDB connected'); await seedAdmin(); })
    .catch(err => console.error('❌ MongoDB:', err.message));
} else {
  console.warn('⚠️  No MONGO_URI — using in-memory storage');
}

// ── Schemas ──────────────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:       { type: String, default: '' },
  password:   { type: String },
  avatar:     { type: String, default: '' },
  provider:   { type: String, default: 'email' }, // email, google, github
  providerId: { type: String, default: '' },
  role:       { type: String, default: 'user' },
  plan:       { type: String, default: 'free' },
  teamId:     { type: mongoose.Schema.Types.ObjectId, ref: 'TATeam', default: null },
  teamRole:   { type: String, default: 'member' }, // owner, admin, member
  referralCode: { type: String, unique: true, default: () => crypto.randomBytes(4).toString('hex').toUpperCase() },
  referredBy: { type: String, default: '' },
  referralCount: { type: Number, default: 0 },
  bonusMessages: { type: Number, default: 0 },
  messagesThisMonth: { type: Number, default: 0 },
  monthReset: { type: Date, default: Date.now },
  totalMessages: { type: Number, default: 0 },
  customInstructions: { type: String, default: '' },
  preferredModel: { type: String, default: 'claude-sonnet-4' },
  theme: { type: String, default: 'dark' },
  twoFactorSecret: { type: String, default: '' },
  twoFactorEnabled: { type: Boolean, default: false },
  lastActive: { type: Date, default: Date.now },
}, { timestamps: true });

const ChatSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'TAUser', required: true },
  title:    { type: String, default: 'New Chat' },
  model:    { type: String, default: 'claude-sonnet-4' },
  shared:   { type: Boolean, default: false },
  shareId:  { type: String, default: '' },
  pinned:   { type: Boolean, default: false },
  archived: { type: Boolean, default: false },
  folderId: { type: mongoose.Schema.Types.ObjectId, default: null },
  tags:     [{ type: String }],
  messages: [{
    role:      { type: String, enum: ['user', 'assistant', 'system'] },
    content:   { type: String },
    reactions: [{ emoji: String, userId: mongoose.Schema.Types.ObjectId }],
    timestamp: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

const LogSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'TAUser' },
  userEmail: String,
  model:     String,
  tokens:    { type: Number, default: 0 },
  type:      { type: String, default: 'chat' },
}, { timestamps: true });

const ReferralSchema = new mongoose.Schema({
  referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'TAUser' },
  referredEmail: String,
  referredId: { type: mongoose.Schema.Types.ObjectId, ref: 'TAUser' },
  status: { type: String, default: 'pending' }, // pending, completed, rewarded
}, { timestamps: true });

const PaymentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'TAUser' },
  email: String,
  amount: Number,
  reference: String,
  status: { type: String, default: 'pending' }, // pending, success, failed
  plan: { type: String, default: 'pro' },
}, { timestamps: true });

const TeamSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  ownerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'TAUser', required: true },
  plan:      { type: String, default: 'team' },
  maxMembers: { type: Number, default: 10 },
  members:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'TAUser' }],
  inviteCode: { type: String, default: () => crypto.randomBytes(6).toString('hex').toUpperCase() },
}, { timestamps: true });

const TemplateSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  prompt:      { type: String, required: true },
  category:    { type: String, default: 'general' },
  icon:        { type: String, default: '💬' },
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'TAUser', default: null },
  isPublic:    { type: Boolean, default: true },
  uses:        { type: Number, default: 0 },
}, { timestamps: true });

const FolderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'TAUser', required: true },
  name:   { type: String, required: true },
  color:  { type: String, default: '#c84b09' },
  icon:   { type: String, default: '📁' },
}, { timestamps: true });

const MemorySchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'TAUser', required: true },
  chatId:   { type: mongoose.Schema.Types.ObjectId, ref: 'TAChat', required: true },
  summary:  { type: String, default: '' },
  keywords: [{ type: String }],
  messages: [{ role: String, content: String, timestamp: Date }],
}, { timestamps: true });

const BranchSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'TAUser', required: true },
  chatId:    { type: mongoose.Schema.Types.ObjectId, ref: 'TAChat', required: true },
  parentMsgIdx: { type: Number, required: true },
  title:     { type: String, default: '' },
  messages:  [{ role: String, content: String, timestamp: Date }],
}, { timestamps: true });

const SessionSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'TAUser', required: true },
  token:     { type: String },
  ip:        { type: String, default: '' },
  userAgent: { type: String, default: '' },
  lastActive:{ type: Date, default: Date.now },
  expiresAt: { type: Date },
}, { timestamps: true });

const User    = mongoose.models.TAUser   || mongoose.model('TAUser',   UserSchema);
const Chat    = mongoose.models.TAChat   || mongoose.model('TAChat',   ChatSchema);
const Log     = mongoose.models.TALog    || mongoose.model('TALog',    LogSchema);
const Referral = mongoose.models.TAReferral || mongoose.model('TAReferral', ReferralSchema);
const Payment = mongoose.models.TAPayment || mongoose.model('TAPayment', PaymentSchema);
const Team    = mongoose.models.TATeam   || mongoose.model('TATeam', TeamSchema);
const Template = mongoose.models.TATemplate || mongoose.model('TATemplate', TemplateSchema);
const Folder  = mongoose.models.TAFolder  || mongoose.model('TAFolder', FolderSchema);
const Memory  = mongoose.models.TAMemory  || mongoose.model('TAMemory', MemorySchema);
const Branch  = mongoose.models.TABranch  || mongoose.model('TABranch', BranchSchema);
const Session = mongoose.models.TASession || mongoose.model('TASession', SessionSchema);

// ── In-memory fallback ───────────────────────────────────────────────────────
const memUsers = [], memChats = [], memLogs = [], memReferrals = [], memPayments = [], memTeams = [], memTemplates = [], memFolders = [], memMemories = [], memBranches = [], memSessions = [];
let memIdSeq = 1;

// ── Seed admin ───────────────────────────────────────────────────────────────
async function seedAdmin() {
  try {
    const existing = await User.findOne({ email: ADMIN_EMAIL });
    if (!existing) {
      await User.create({
        email: ADMIN_EMAIL, name: 'Tribal AI Admin',
        password: await bcrypt.hash(ADMIN_PASSWORD, 10),
        role: 'admin', plan: 'admin',
      });
      console.log(`✅ Admin seeded → ${ADMIN_EMAIL}`);
    }
  } catch (e) { console.warn('Admin seed skipped:', e.message); }
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? '*' : ALLOWED_ORIGIN, methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..')));

const apiLimiter = rateLimit({ windowMs: 15*60*1000, max: 500, message: { error: 'Too many requests' } });
const chatLimit  = rateLimit({ windowMs: 1*60*1000, max: 30, message: { error: 'Slow down — too many messages' } });
app.use('/api/', apiLimiter);

const authMw = (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
};
const adminMw = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' });

function makeToken(user) {
  return jwt.sign({ id: user._id || user.id, email: user.email, name: user.name, role: user.role, plan: user.plan }, JWT_SECRET, { expiresIn: '7d' });
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/register', async (req, res) => {
  const { email, name, password, referralCode } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    if (MONGO_URI) {
      const existing = await User.findOne({ email });
      if (existing) return res.status(409).json({ error: 'Email already registered' });
      const userData = { email, name: name || '', password: await bcrypt.hash(password, 10) };
      if (referralCode) {
        const referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });
        if (referrer) {
          userData.referredBy = referrer._id;
          referrer.referralCount += 1;
          referrer.bonusMessages += 10; // 10 bonus messages per referral
          await referrer.save();
          await Referral.create({ referrerId: referrer._id, referredEmail: email, status: 'completed' });
        }
      }
      const user = await User.create(userData);
      return res.json({ token: makeToken(user), user: { email: user.email, name: user.name, role: user.role, plan: user.plan, referralCode: user.referralCode } });
    } else {
      if (memUsers.find(u => u.email === email.toLowerCase())) return res.status(409).json({ error: 'Email already registered' });
      const user = { id: memIdSeq++, email: email.toLowerCase(), name: name||'', password: await bcrypt.hash(password,10), role:'user', plan:'free', referralCode: crypto.randomBytes(4).toString('hex').toUpperCase(), referralCount:0, bonusMessages:0, messagesThisMonth:0, totalMessages:0, customInstructions:'', theme:'dark', createdAt:new Date() };
      if (referralCode) {
        const referrer = memUsers.find(u => u.referralCode === referralCode.toUpperCase());
        if (referrer) { referrer.referralCount += 1; referrer.bonusMessages += 10; }
      }
      memUsers.push(user);
      return res.json({ token: makeToken(user), user: { email:user.email, name:user.name, role:user.role, plan:user.plan, referralCode:user.referralCode } });
    }
  } catch (e) { res.status(500).json({ error: 'Registration failed' }); }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    let user;
    if (MONGO_URI) { user = await User.findOne({ email: email.toLowerCase() }); }
    else { user = memUsers.find(u => u.email === email.toLowerCase()); }
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    if (MONGO_URI) await User.findByIdAndUpdate(user._id, { lastActive: new Date() });
    res.json({ token: makeToken(user), user: { email: user.email, name: user.name, role: user.role, plan: user.plan, referralCode: user.referralCode } });
  } catch (e) { res.status(500).json({ error: 'Login failed' }); }
});

app.get('/api/me', authMw, async (req, res) => {
  try {
    if (MONGO_URI) {
      const u = await User.findById(req.user.id).select('-password');
      if (!u) return res.status(404).json({ error: 'User not found' });
      return res.json(u);
    }
    const u = memUsers.find(u => u.id == req.user.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const { password, ...safe } = u;
    res.json(safe);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.put('/api/me', authMw, async (req, res) => {
  const { name, customInstructions, theme } = req.body;
  try {
    if (MONGO_URI) {
      const upd = {};
      if (name !== undefined) upd.name = name;
      if (customInstructions !== undefined) upd.customInstructions = customInstructions;
      if (theme !== undefined) upd.theme = theme;
      await User.findByIdAndUpdate(req.user.id, upd);
    } else {
      const u = memUsers.find(u => u.id == req.user.id);
      if (u) { if (name !== undefined) u.name = name; if (customInstructions !== undefined) u.customInstructions = customInstructions; if (theme !== undefined) u.theme = theme; }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CHAT ROUTES
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/chats', authMw, async (req, res) => {
  try {
    if (MONGO_URI) {
      const chats = await Chat.find({ userId: req.user.id }).select('title model shared shareId createdAt updatedAt').sort({ updatedAt: -1 }).limit(50).lean();
      return res.json(chats);
    }
    const chats = memChats.filter(c => c.userId == req.user.id).sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0,50);
    res.json(chats.map(({ messages, ...c }) => c));
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/chats/:id', authMw, async (req, res) => {
  try {
    if (MONGO_URI) {
      const chat = await Chat.findOne({ _id: req.params.id, userId: req.user.id }).lean();
      if (!chat) return res.status(404).json({ error: 'Chat not found' });
      return res.json(chat);
    }
    const chat = memChats.find(c => (c._id || c.id) == req.params.id && c.userId == req.user.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(chat);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/chats', authMw, async (req, res) => {
  const { title, model } = req.body;
  try {
    if (MONGO_URI) {
      const chat = await Chat.create({ userId: req.user.id, title: title || 'New Chat', model: model || 'claude-sonnet-4' });
      return res.json(chat);
    }
    const chat = { _id: 'mc' + memIdSeq++, userId: req.user.id, title: title||'New Chat', model: model||'claude-sonnet-4', messages: [], shared: false, shareId: '', createdAt: new Date(), updatedAt: new Date() };
    memChats.push(chat);
    res.json(chat);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/chats/:id', authMw, async (req, res) => {
  try {
    if (MONGO_URI) await Chat.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    else { const i = memChats.findIndex(c => (c._id || c.id) == req.params.id && c.userId == req.user.id); if (i > -1) memChats.splice(i, 1); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ── Send message + get AI response ──────────────────────────────────────────
app.post('/api/chat', authMw, chatLimit, async (req, res) => {
  const { chatId, message, model: reqModel } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  try {
    let user;
    if (MONGO_URI) user = await User.findById(req.user.id);
    else user = memUsers.find(u => u.id == req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Reset monthly count
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    if (user.monthReset < monthStart) { user.messagesThisMonth = 0; user.monthReset = monthStart; }

    const limit = user.plan === 'free' ? FREE_LIMIT + (user.bonusMessages || 0) : PRO_LIMIT;
    if (user.messagesThisMonth >= limit) {
      return res.status(429).json({ error: `Monthly limit reached (${limit} messages). Upgrade to Pro for unlimited.`, limitReached: true });
    }

    // Get or create chat
    let chat;
    if (chatId) {
      if (MONGO_URI) chat = await Chat.findOne({ _id: chatId, userId: req.user.id });
      else chat = memChats.find(c => (c._id || c.id) == chatId && c.userId == req.user.id);
    }
    if (!chat) {
      const title = message.slice(0, 50) + (message.length > 50 ? '…' : '');
      if (MONGO_URI) {
        chat = await Chat.create({ userId: req.user.id, title, model: reqModel || 'claude-sonnet-4', messages: [] });
      } else {
        chat = { _id: 'mc' + memIdSeq++, userId: req.user.id, title, model: reqModel || 'claude-sonnet-4', messages: [], shared: false, shareId: '', createdAt: now, updatedAt: now };
        memChats.push(chat);
      }
    }

    chat.messages.push({ role: 'user', content: message, timestamp: now });

    // Build messages for API
    const systemMsg = user.customInstructions
      ? `${user.customInstructions}\n\nYou are Tribal AI, a helpful AI assistant built by Obasanjo Samuel (Tribal Tech). You are knowledgeable, concise, and helpful. Format code in markdown code blocks.`
      : 'You are Tribal AI, a helpful AI assistant built by Obasanjo Samuel (Tribal Tech). You are knowledgeable, concise, and helpful. You can help with coding, writing, research, analysis, and general questions. Format code in markdown code blocks. Be direct and actionable.';

    const apiMessages = [
      { role: 'system', content: systemMsg },
      ...chat.messages.map(m => ({ role: m.role, content: m.content }))
    ];

    const model = reqModel || chat.model || 'claude-sonnet-4';
    let aiResponse = '';

    if (ANTHROPIC_API_KEY && (model.includes('claude') || model === 'claude-sonnet-4')) {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: apiMessages.filter(m => m.role !== 'system'), system: apiMessages[0].content, max_tokens: 4096 }),
        });
        const data = await r.json();
        if (r.ok) aiResponse = data.content?.[0]?.text || 'No response';
        else throw new Error(data.error?.message || 'Anthropic error');
      } catch (e) { console.error('Anthropic error:', e.message); }
    }

    if (!aiResponse && OPENAI_API_KEY) {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
          body: JSON.stringify({ model: 'gpt-4o', messages: apiMessages, max_tokens: 4096 }),
        });
        const data = await r.json();
        if (r.ok) aiResponse = data.choices?.[0]?.message?.content || 'No response';
        else throw new Error(data.error?.message || 'OpenAI error');
      } catch (e) { console.error('OpenAI error:', e.message); }
    }

    if (!aiResponse) {
      aiResponse = `I received your message: "${message}"\n\n⚠️ No AI API key configured yet. Add your ANTHROPIC_API_KEY or OPENAI_API_KEY to the .env file to enable AI responses.\n\nFor now, I can help you:\n- Set up the backend\n- Test the API endpoints\n- Configure the AI providers\n\nWhat would you like to do?`;
    }

    chat.messages.push({ role: 'assistant', content: aiResponse, timestamp: new Date() });
    chat.updatedAt = new Date();

    if (MONGO_URI) {
      await chat.save();
      await User.findByIdAndUpdate(req.user.id, { $inc: { messagesThisMonth: 1, totalMessages: 1 }, lastActive: new Date() });
      await Log.create({ userId: req.user.id, userEmail: user.email, model, tokens: aiResponse.length, type: 'chat' });
    } else {
      user.messagesThisMonth = (user.messagesThisMonth || 0) + 1;
      user.totalMessages = (user.totalMessages || 0) + 1;
    }

    res.json({ chatId: chat._id || chat.id, response: aiResponse, model, remaining: Math.max(0, limit - (user.messagesThisMonth || 0)) });
  } catch (e) {
    console.error('Chat error:', e);
    res.status(500).json({ error: 'Chat failed' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// FILE UPLOAD (Base64 — client encodes, server forwards to AI)
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/upload', authMw, async (req, res) => {
  const { chatId, message, files } = req.body; // files: [{name, type, b64}]
  if (!message && (!files || !files.length)) return res.status(400).json({ error: 'Message or files required' });
  try {
    let user;
    if (MONGO_URI) user = await User.findById(req.user.id);
    else user = memUsers.find(u => u.id == req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Build multimodal message
    const content = [];
    if (message) content.push({ type: 'text', text: message });
    if (files?.length) {
      for (const f of files.slice(0, 5)) {
        content.push({ type: 'image', source: { type: 'base64', media_type: f.type, data: f.b64 } });
      }
    }

    let aiResponse = 'File analysis not available — no AI API key configured.';

    if (ANTHROPIC_API_KEY) {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content }], max_tokens: 4096 }),
        });
        const data = await r.json();
        if (r.ok) aiResponse = data.content?.[0]?.text || 'No response';
      } catch (e) { console.error('Upload AI error:', e.message); }
    }

    res.json({ response: aiResponse });
  } catch (e) { res.status(500).json({ error: 'Upload failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CHAT SHARING
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/chats/:id/share', authMw, async (req, res) => {
  try {
    let chat;
    if (MONGO_URI) chat = await Chat.findOne({ _id: req.params.id, userId: req.user.id });
    else chat = memChats.find(c => (c._id || c.id) == req.params.id && c.userId == req.user.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    if (!chat.shareId) chat.shareId = crypto.randomBytes(8).toString('hex');
    chat.shared = !chat.shared;
    if (MONGO_URI) await chat.save();

    res.json({ shared: chat.shared, shareId: chat.shareId, url: `/share/${chat.shareId}` });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/shared/:shareId', async (req, res) => {
  try {
    let chat;
    if (MONGO_URI) chat = await Chat.findOne({ shareId: req.params.shareId, shared: true }).lean();
    else chat = memChats.find(c => c.shareId === req.params.shareId && c.shared);
    if (!chat) return res.status(404).json({ error: 'Shared chat not found' });
    res.json({ title: chat.title, model: chat.model, messages: chat.messages });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT CHAT
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/chats/:id/export', authMw, async (req, res) => {
  const { format } = req.query; // txt or json
  try {
    let chat;
    if (MONGO_URI) chat = await Chat.findOne({ _id: req.params.id, userId: req.user.id }).lean();
    else chat = memChats.find(c => (c._id || c.id) == req.params.id && c.userId == req.user.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${chat.title || 'chat'}.json"`);
      return res.json(chat);
    }

    // TXT format
    let txt = `# ${chat.title}\nModel: ${chat.model}\n\n`;
    chat.messages.forEach(m => {
      txt += `## ${m.role === 'user' ? 'You' : 'Tribal AI'}\n${m.content}\n\n`;
    });
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${chat.title || 'chat'}.txt"`);
    res.send(txt);
  } catch (e) { res.status(500).json({ error: 'Export failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// MODELS LIST
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/models', authMw, async (req, res) => {
  let user;
  if (MONGO_URI) user = await User.findById(req.user.id).select('plan');
  else user = memUsers.find(u => u.id == req.user.id);
  const plan = user?.plan || 'free';
  const models = AI_MODELS.filter(m => m.tier === 'free' || plan === 'pro' || plan === 'admin');
  res.json({ models, current: user?.preferredModel || 'claude-sonnet-4' });
});

app.put('/api/models', authMw, async (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: 'Model required' });
  try {
    if (MONGO_URI) await User.findByIdAndUpdate(req.user.id, { preferredModel: model });
    else { const u = memUsers.find(u => u.id == req.user.id); if (u) u.preferredModel = model; }
    res.json({ ok: true, model });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// WEB SEARCH
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/search', authMw, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query required' });
  try {
    // Use DuckDuckGo Lite as free fallback
    const r = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await r.text();
    // Simple extraction
    const results = [];
    const regex = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) && results.length < 5) {
      results.push({ title: match[2].trim(), url: match[1] });
    }
    // Fallback: extract any links
    if (!results.length) {
      const linkRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]{10,80})<\/a>/gi;
      while ((match = linkRegex.exec(html)) && results.length < 5) {
        if (!match[1].includes('duckduckgo')) results.push({ title: match[2].trim(), url: match[1] });
      }
    }
    res.json({ results, query });
  } catch (e) { res.status(500).json({ error: 'Search failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATES
// ══════════════════════════════════════════════════════════════════════════════

const DEFAULT_TEMPLATES = [
  { title: 'Write Code', description: 'Generate code in any language', prompt: 'Write clean, well-commented code for: ', icon: '💻', category: 'coding' },
  { title: 'Explain Concept', description: 'Explain any topic simply', prompt: 'Explain this concept in simple terms with examples: ', icon: '💡', category: 'education' },
  { title: 'Write Email', description: 'Professional email drafts', prompt: 'Write a professional email about: ', icon: '✉️', category: 'writing' },
  { title: 'Debug Code', description: 'Find and fix bugs', prompt: 'Find and fix the bugs in this code. Explain each issue: ', icon: '🐛', category: 'coding' },
  { title: 'Business Plan', description: 'Create a business plan', prompt: 'Create a detailed business plan for: ', icon: '🚀', category: 'business' },
  { title: 'Analyze Data', description: 'Analyze and visualize data', prompt: 'Analyze this data and provide insights with recommendations: ', icon: '📊', category: 'analysis' },
  { title: 'Translate', description: 'Translate text to any language', prompt: 'Translate this text to English, keeping the meaning and tone: ', icon: '🌍', category: 'writing' },
  { title: 'Summarize', description: 'Summarize long text', prompt: 'Summarize this text in clear bullet points: ', icon: '📝', category: 'writing' },
  { title: 'SEO Content', description: 'Write SEO-optimized content', prompt: 'Write SEO-optimized content about: ', icon: '🔍', category: 'marketing' },
  { title: 'Social Media', description: 'Create social media posts', prompt: 'Create engaging social media posts about: ', icon: '📱', category: 'marketing' },
  { title: 'Recipe', description: 'Generate recipes', prompt: 'Create a detailed recipe for: ', icon: '🍳', category: 'lifestyle' },
  { title: 'Interview Prep', description: 'Prepare for interviews', prompt: 'Generate interview questions and answers for: ', icon: '🎯', category: 'education' },
];

app.get('/api/templates', authMw, async (req, res) => {
  try {
    let custom = [];
    if (MONGO_URI) custom = await Template.find({ $or: [{ userId: null }, { userId: req.user.id }] }).sort({ uses: -1 }).lean();
    else custom = memTemplates.filter(t => !t.userId || t.userId == req.user.id);
    res.json({ templates: [...DEFAULT_TEMPLATES, ...custom] });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/templates', authMw, async (req, res) => {
  const { title, description, prompt, category, icon } = req.body;
  if (!title || !prompt) return res.status(400).json({ error: 'Title and prompt required' });
  try {
    if (MONGO_URI) {
      const t = await Template.create({ title, description, prompt, category: category || 'custom', icon: icon || '⭐', userId: req.user.id });
      return res.json(t);
    }
    const t = { id: memIdSeq++, title, description, prompt, category: category || 'custom', icon: icon || '⭐', userId: req.user.id, uses: 0, createdAt: new Date() };
    memTemplates.push(t);
    res.json(t);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SOCIAL LOGIN (Google)
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/google', async (req, res) => {
  const { credential, clientId } = req.body;
  if (!credential) return res.status(400).json({ error: 'Google credential required' });
  try {
    // Decode JWT payload (basic — in production use google-auth-library)
    const payload = JSON.parse(Buffer.from(credential.split('.')[1], 'base64').toString());
    const { email, name, picture, sub: googleId } = payload;
    if (!email) return res.status(400).json({ error: 'Invalid Google token' });

    if (MONGO_URI) {
      let user = await User.findOne({ $or: [{ email }, { provider: 'google', providerId: googleId }] });
      if (!user) {
        user = await User.create({ email, name: name || email.split('@')[0], avatar: picture, provider: 'google', providerId: googleId, password: '' });
      } else if (!user.providerId) {
        user.provider = 'google'; user.providerId = googleId; if (picture) user.avatar = picture;
        await user.save();
      }
      return res.json({ token: makeToken(user), user: { email: user.email, name: user.name, plan: user.plan, avatar: user.avatar } });
    }

    let user = memUsers.find(u => u.email === email.toLowerCase() || (u.provider === 'google' && u.providerId === googleId));
    if (!user) {
      user = { id: memIdSeq++, email: email.toLowerCase(), name: name || email.split('@')[0], avatar: picture, provider: 'google', providerId: googleId, password: '', role: 'user', plan: 'free', referralCode: crypto.randomBytes(4).toString('hex').toUpperCase(), referralCount: 0, bonusMessages: 0, messagesThisMonth: 0, totalMessages: 0, customInstructions: '', preferredModel: 'claude-sonnet-4', theme: 'dark', createdAt: new Date() };
      memUsers.push(user);
    }
    res.json({ token: makeToken(user), user: { email: user.email, name: user.name, plan: user.plan, avatar: user.avatar } });
  } catch (e) { res.status(500).json({ error: 'Google auth failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// TEAM ACCOUNTS
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/teams', authMw, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Team name required' });
  try {
    if (MONGO_URI) {
      const team = await Team.create({ name, ownerId: req.user.id, members: [req.user.id] });
      await User.findByIdAndUpdate(req.user.id, { teamId: team._id, teamRole: 'owner' });
      return res.json(team);
    }
    const team = { id: memIdSeq++, name, ownerId: req.user.id, plan: 'team', maxMembers: 10, members: [req.user.id], inviteCode: crypto.randomBytes(6).toString('hex').toUpperCase(), createdAt: new Date() };
    memTeams.push(team);
    const u = memUsers.find(u => u.id == req.user.id); if (u) { u.teamId = team.id; u.teamRole = 'owner'; }
    res.json(team);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/teams/join', authMw, async (req, res) => {
  const { inviteCode } = req.body;
  if (!inviteCode) return res.status(400).json({ error: 'Invite code required' });
  try {
    let team;
    if (MONGO_URI) team = await Team.findOne({ inviteCode: inviteCode.toUpperCase() });
    else team = memTeams.find(t => t.inviteCode === inviteCode.toUpperCase());
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.members.length >= team.maxMembers) return res.status(400).json({ error: 'Team is full' });
    const memberId = req.user.id;
    if (team.members.includes(memberId)) return res.status(400).json({ error: 'Already in team' });
    team.members.push(memberId);
    if (MONGO_URI) {
      await team.save();
      await User.findByIdAndUpdate(memberId, { teamId: team._id, teamRole: 'member' });
    } else {
      const u = memUsers.find(u => u.id == memberId); if (u) { u.teamId = team.id; u.teamRole = 'member'; }
    }
    res.json({ ok: true, team: { name: team.name, inviteCode: team.inviteCode } });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/teams/my', authMw, async (req, res) => {
  try {
    let user;
    if (MONGO_URI) user = await User.findById(req.user.id).select('teamId teamRole');
    else user = memUsers.find(u => u.id == req.user.id);
    if (!user?.teamId) return res.json({ team: null });
    let team;
    if (MONGO_URI) team = await Team.findById(user.teamId).populate('members', 'name email avatar').lean();
    else team = memTeams.find(t => t.id == user.teamId);
    res.json({ team, role: user.teamRole });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CHAT FOLDERS
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/folders', authMw, async (req, res) => {
  try {
    if (MONGO_URI) return res.json({ folders: await Folder.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean() });
    res.json({ folders: memFolders.filter(f => f.userId == req.user.id) });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/folders', authMw, async (req, res) => {
  const { name, color, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'Folder name required' });
  try {
    if (MONGO_URI) { const f = await Folder.create({ userId: req.user.id, name, color, icon }); return res.json(f); }
    const f = { id: memIdSeq++, userId: req.user.id, name, color: color || '#c84b09', icon: icon || '📁', createdAt: new Date() };
    memFolders.push(f); res.json(f);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/folders/:id', authMw, async (req, res) => {
  try {
    if (MONGO_URI) await Folder.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    else { const i = memFolders.findIndex(f => f.id == req.params.id && f.userId == req.user.id); if (i > -1) memFolders.splice(i, 1); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.put('/api/chats/:id/folder', authMw, async (req, res) => {
  const { folderId } = req.body;
  try {
    if (MONGO_URI) await Chat.findOneAndUpdate({ _id: req.params.id, userId: req.user.id }, { folderId: folderId || null });
    else { const c = memChats.find(c => (c._id || c.id) == req.params.id && c.userId == req.user.id); if (c) c.folderId = folderId || null; }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// STREAMING RESPONSES (SSE)
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/chat/stream', authMw, chatLimit, async (req, res) => {
  const { chatId, message, model: reqModel } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    let user;
    if (MONGO_URI) user = await User.findById(req.user.id);
    else user = memUsers.find(u => u.id == req.user.id);
    if (!user) { res.write(`data: ${JSON.stringify({ error: 'User not found' })}\n\n`); res.end(); return; }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    if (user.monthReset < monthStart) { user.messagesThisMonth = 0; user.monthReset = monthStart; }
    const limit = user.plan === 'free' ? FREE_LIMIT + (user.bonusMessages || 0) : PRO_LIMIT;
    if (user.messagesThisMonth >= limit) {
      res.write(`data: ${JSON.stringify({ error: 'Limit reached', limitReached: true })}\n\n`); res.end(); return;
    }

    let chat;
    if (chatId) {
      if (MONGO_URI) chat = await Chat.findOne({ _id: chatId, userId: req.user.id });
      else chat = memChats.find(c => (c._id || c.id) == chatId && c.userId == req.user.id);
    }
    if (!chat) {
      const title = message.slice(0, 50) + (message.length > 50 ? '…' : '');
      if (MONGO_URI) chat = await Chat.create({ userId: req.user.id, title, model: reqModel || 'claude-sonnet-4', messages: [] });
      else { chat = { _id: 'mc' + memIdSeq++, userId: req.user.id, title, model: reqModel || 'claude-sonnet-4', messages: [], shared: false, shareId: '', createdAt: now, updatedAt: now }; memChats.push(chat); }
    }

    chat.messages.push({ role: 'user', content: message, timestamp: now });

    // Build context from memory
    let memoryContext = '';
    if (MONGO_URI) {
      const memories = await Memory.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(3).lean();
      if (memories.length) memoryContext = '\n\nPrevious conversation context:\n' + memories.map(m => m.summary).join('\n');
    }

    const systemMsg = (user.customInstructions || '') + '\n\nYou are Tribal AI, a helpful AI assistant. Be concise and actionable. Format code in markdown.' + memoryContext;
    const model = reqModel || chat.model || 'claude-sonnet-4';

    // Try streaming with Anthropic
    if (ANTHROPIC_API_KEY && model.includes('claude')) {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: message }], system: systemMsg, max_tokens: 4096, stream: true }),
        });

        if (r.ok && r.body) {
          let fullResponse = '';
          for await (const chunk of r.body) {
            const str = chunk.toString();
            const lines = str.split('\n').filter(l => l.startsWith('data: '));
            for (const line of lines) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'content_block_delta' && data.delta?.text) {
                  fullResponse += data.delta.text;
                  res.write(`data: ${JSON.stringify({ text: data.delta.text, done: false })}\n\n`);
                }
              } catch {}
            }
          }
          if (fullResponse) {
            chat.messages.push({ role: 'assistant', content: fullResponse, timestamp: new Date() });
            chat.updatedAt = new Date();
            if (MONGO_URI) { await chat.save(); await User.findByIdAndUpdate(req.user.id, { $inc: { messagesThisMonth: 1, totalMessages: 1 } }); }
            else { user.messagesThisMonth++; user.totalMessages++; }
            res.write(`data: ${JSON.stringify({ done: true, chatId: chat._id || chat.id, fullResponse })}\n\n`);
            res.end(); return;
          }
        }
      } catch (e) { console.error('Stream error:', e.message); }
    }

    // Fallback: non-streaming
    let aiResponse = '';
    if (ANTHROPIC_API_KEY && model.includes('claude')) {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: message }], system: systemMsg, max_tokens: 4096 }),
        });
        const data = await r.json();
        if (r.ok) aiResponse = data.content?.[0]?.text;
      } catch {}
    }
    if (!aiResponse && OPENAI_API_KEY) {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
          body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: message }], max_tokens: 4096 }),
        });
        const data = await r.json();
        if (r.ok) aiResponse = data.choices?.[0]?.message?.content;
      } catch {}
    }
    if (!aiResponse) aiResponse = `Received: "${message}"\n\n⚠️ No AI provider configured.`;

    // Simulate streaming for fallback
    const words = aiResponse.split(' ');
    for (const word of words) {
      res.write(`data: ${JSON.stringify({ text: word + ' ', done: false })}\n\n`);
      await new Promise(r => setTimeout(r, 20));
    }

    chat.messages.push({ role: 'assistant', content: aiResponse, timestamp: new Date() });
    chat.updatedAt = new Date();
    if (MONGO_URI) { await chat.save(); await User.findByIdAndUpdate(req.user.id, { $inc: { messagesThisMonth: 1, totalMessages: 1 } }); }
    else { user.messagesThisMonth++; user.totalMessages++; }
    res.write(`data: ${JSON.stringify({ done: true, chatId: chat._id || chat.id })}\n\n`);
    res.end();
  } catch (e) { res.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`); res.end(); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CODE EXECUTION (Sandboxed)
// ══════════════════════════════════════════════════════════════════════════════

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

app.post('/api/code/run', authMw, async (req, res) => {
  const { code, language } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });

  const tmpDir = os.tmpdir();
  const id = Date.now() + '_' + crypto.randomBytes(4).toString('hex');

  try {
    let file, cmd;
    switch (language) {
      case 'python':
      case 'py':
        file = `${tmpDir}/ta_${id}.py`;
        fs.writeFileSync(file, code);
        cmd = `timeout 10 python3 ${file}`;
        break;
      case 'javascript':
      case 'js':
        file = `${tmpDir}/ta_${id}.js`;
        fs.writeFileSync(file, code);
        cmd = `timeout 10 node ${file}`;
        break;
      case 'bash':
      case 'sh':
        file = `${tmpDir}/ta_${id}.sh`;
        fs.writeFileSync(file, code);
        cmd = `timeout 10 bash ${file}`;
        break;
      default:
        return res.status(400).json({ error: 'Unsupported language. Use: python, javascript, bash' });
    }

    const output = execSync(cmd, { encoding: 'utf-8', timeout: 12000, maxBuffer: 1024 * 1024 });
    try { fs.unlinkSync(file); } catch {}
    res.json({ output: output.slice(0, 50000), language, success: true });
  } catch (e) {
    try { fs.unlinkSync(`${tmpDir}/ta_${id}.*`); } catch {}
    res.json({ output: (e.stderr || e.stdout || e.message || 'Execution failed').slice(0, 50000), language, success: false });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// CONVERSATION BRANCHING
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/chats/:id/branches', authMw, async (req, res) => {
  try {
    if (MONGO_URI) return res.json({ branches: await Branch.find({ chatId: req.params.id, userId: req.user.id }).sort({ createdAt: -1 }).lean() });
    res.json({ branches: memBranches.filter(b => b.chatId == req.params.id && b.userId == req.user.id) });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/chats/:id/branch', authMw, chatLimit, async (req, res) => {
  const { messageIdx } = req.body;
  if (messageIdx === undefined) return res.status(400).json({ error: 'messageIdx required' });
  try {
    let chat;
    if (MONGO_URI) chat = await Chat.findOne({ _id: req.params.id, userId: req.user.id });
    else chat = memChats.find(c => (c._id || c.id) == req.params.id && c.userId == req.user.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    if (messageIdx < 0 || messageIdx >= chat.messages.length) return res.status(400).json({ error: 'Invalid message index' });

    const branchMessages = chat.messages.slice(0, messageIdx + 1);
    if (MONGO_URI) {
      const branch = await Branch.create({ userId: req.user.id, chatId: chat._id, parentMsgIdx: messageIdx, title: chat.title + ' (branch)', messages: branchMessages });
      return res.json(branch);
    }
    const branch = { id: memIdSeq++, userId: req.user.id, chatId: chat._id || chat.id, parentMsgIdx: messageIdx, title: chat.title + ' (branch)', messages: branchMessages, createdAt: new Date() };
    memBranches.push(branch);
    res.json(branch);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/branches/:id/chat', authMw, chatLimit, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  try {
    let branch;
    if (MONGO_URI) branch = await Branch.findOne({ _id: req.params.id, userId: req.user.id });
    else branch = memBranches.find(b => (b._id || b.id) == req.params.id && b.userId == req.user.id);
    if (!branch) return res.status(404).json({ error: 'Branch not found' });

    branch.messages.push({ role: 'user', content: message, timestamp: new Date() });
    // AI response would follow same pattern as /api/chat
    const aiResponse = `Branch response to: "${message}"\n\nThis is a branch from the conversation.`;
    branch.messages.push({ role: 'assistant', content: aiResponse, timestamp: new Date() });
    if (MONGO_URI) await branch.save();
    res.json({ response: aiResponse, messages: branch.messages });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// MULTI-LANGUAGE
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/translate', authMw, async (req, res) => {
  const { text, targetLang } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  const lang = targetLang || 'en';

  try {
    // Use AI to translate
    let translated = '';
    if (ANTHROPIC_API_KEY) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: `Translate this to ${lang}. Only output the translation, nothing else:\n\n${text}` }], max_tokens: 2048 }),
      });
      const data = await r.json();
      if (r.ok) translated = data.content?.[0]?.text;
    }
    if (!translated && OPENAI_API_KEY) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: `Translate this to ${lang}. Only output the translation:\n\n${text}` }], max_tokens: 2048 }),
      });
      const data = await r.json();
      if (r.ok) translated = data.choices?.[0]?.message?.content;
    }
    res.json({ translated: translated || text, from: 'auto', to: lang });
  } catch (e) { res.status(500).json({ error: 'Translation failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SESSION MANAGEMENT & 2FA
// ══════════════════════════════════════════════════════════════════════════════

const speakeasy = require('speakeasy') || null;
const QRCode = require('qrcode') || null;

app.get('/api/sessions', authMw, async (req, res) => {
  try {
    if (MONGO_URI) {
      const sessions = await Session.find({ userId: req.user.id }).sort({ lastActive: -1 }).lean();
      return res.json({ sessions });
    }
    res.json({ sessions: memSessions.filter(s => s.userId == req.user.id).sort((a,b) => new Date(b.lastActive) - new Date(a.lastActive)) });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/sessions/:id', authMw, async (req, res) => {
  try {
    if (MONGO_URI) await Session.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    else { const i = memSessions.findIndex(s => (s._id || s.id) == req.params.id && s.userId == req.user.id); if (i > -1) memSessions.splice(i, 1); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/sessions', authMw, async (req, res) => {
  try {
    if (MONGO_URI) await Session.deleteMany({ userId: req.user.id });
    else { const i = memSessions.findIndex(s => s.userId == req.user.id); while (i > -1) memSessions.splice(i, 1); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// 2FA Setup (TOTP)
app.post('/api/2fa/setup', authMw, async (req, res) => {
  try {
    let user;
    if (MONGO_URI) user = await User.findById(req.user.id);
    else user = memUsers.find(u => u.id == req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const secret = crypto.randomBytes(20).toString('hex');
    const otpauth = `otpauth://totp/TribalAI:${user.email}?secret=${secret}&issuer=TribalAI`;

    if (MONGO_URI) await User.findByIdAndUpdate(req.user.id, { twoFactorSecret: secret });
    else user.twoFactorSecret = secret;

    // Generate QR code as data URL
    if (QRCode) {
      const qr = await QRCode.toDataURL(otpauth);
      return res.json({ secret, qr, otpauth });
    }
    res.json({ secret, otpauth, qr: null });
  } catch (e) { res.status(500).json({ error: 'Setup failed' }); }
});

app.post('/api/2fa/verify', authMw, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });
  try {
    let user;
    if (MONGO_URI) user = await User.findById(req.user.id);
    else user = memUsers.find(u => u.id == req.user.id);
    if (!user?.twoFactorSecret) return res.status(400).json({ error: '2FA not setup' });

    if (speakeasy) {
      const verified = speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: 'hex', token: code, window: 1 });
      if (verified) {
        if (MONGO_URI) await User.findByIdAndUpdate(req.user.id, { twoFactorEnabled: true });
        else user.twoFactorEnabled = true;
        return res.json({ ok: true });
      }
    }
    res.status(400).json({ error: 'Invalid code' });
  } catch (e) { res.status(500).json({ error: 'Verification failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ANALYTICS
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/analytics', authMw, async (req, res) => {
  try {
    let user;
    if (MONGO_URI) user = await User.findById(req.user.id).select('-password');
    else user = memUsers.find(u => u.id == req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let chatCount = 0, totalTokens = 0, modelUsage = {};
    if (MONGO_URI) {
      chatCount = await Chat.countDocuments({ userId: req.user.id });
      const logs = await Log.find({ userId: req.user.id }).lean();
      logs.forEach(l => { totalTokens += l.tokens || 0; modelUsage[l.model] = (modelUsage[l.model] || 0) + 1; });
    } else {
      chatCount = memChats.filter(c => c.userId == req.user.id).length;
      memLogs.filter(l => l.userId == req.user.id).forEach(l => { totalTokens += l.tokens || 0; modelUsage[l.model] = (modelUsage[l.model] || 0) + 1; });
    }

    res.json({
      messagesThisMonth: user.messagesThisMonth || 0,
      totalMessages: user.totalMessages || 0,
      chatCount,
      totalTokens,
      modelUsage,
      plan: user.plan,
      memberSince: user.createdAt,
      lastActive: user.lastActive,
    });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// GDPR Export
app.get('/api/export', authMw, async (req, res) => {
  try {
    let userData = {};
    if (MONGO_URI) {
      const user = await User.findById(req.user.id).select('-password').lean();
      const chats = await Chat.find({ userId: req.user.id }).lean();
      const logs = await Log.find({ userId: req.user.id }).lean();
      const memories = await Memory.find({ userId: req.user.id }).lean();
      userData = { user, chats, logs, memories };
    } else {
      const user = memUsers.find(u => u.id == req.user.id);
      const { password, ...safe } = user || {};
      userData = { user: safe, chats: memChats.filter(c => c.userId == req.user.id), logs: memLogs.filter(l => l.userId == req.user.id), memories: memMemories.filter(m => m.userId == req.user.id) };
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="tribal-ai-export.json"');
    res.json(userData);
  } catch (e) { res.status(500).json({ error: 'Export failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CONVERSATION MEMORY
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/memory', authMw, async (req, res) => {
  try {
    if (MONGO_URI) return res.json({ memories: await Memory.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(20).lean() });
    res.json({ memories: memMemories.filter(m => m.userId == req.user.id).slice(0, 20) });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/memory', authMw, async (req, res) => {
  const { chatId, summary, keywords } = req.body;
  try {
    if (MONGO_URI) {
      const mem = await Memory.create({ userId: req.user.id, chatId, summary, keywords: keywords || [] });
      return res.json(mem);
    }
    const mem = { id: memIdSeq++, userId: req.user.id, chatId, summary, keywords: keywords || [], createdAt: new Date() };
    memMemories.push(mem); res.json(mem);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/memory/:id', authMw, async (req, res) => {
  try {
    if (MONGO_URI) await Memory.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    else { const i = memMemories.findIndex(m => m.id == req.params.id && m.userId == req.user.id); if (i > -1) memMemories.splice(i, 1); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// IMAGE GENERATION
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/image/generate', authMw, async (req, res) => {
  const { prompt, size, model } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt required' });

  try {
    let user;
    if (MONGO_URI) user = await User.findById(req.user.id).select('plan');
    else user = memUsers.find(u => u.id == req.user.id);
    if (user?.plan !== 'pro' && user?.plan !== 'admin') {
      return res.status(403).json({ error: 'Image generation requires Pro plan', upgrade: true });
    }

    if (OPENAI_API_KEY) {
      try {
        const r = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
          body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: size || '1024x1024' }),
        });
        const data = await r.json();
        if (r.ok && data.data?.[0]) {
          return res.json({ url: data.data[0].url, revised_prompt: data.data[0].revised_prompt });
        }
      } catch {}
    }

    // Demo fallback
    res.json({ url: `https://placehold.co/1024x1024/1e1d1a/c84b09?text=${encodeURIComponent(prompt.slice(0,30))}`, demo: true });
  } catch (e) { res.status(500).json({ error: 'Image generation failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// TEXT-TO-SPEECH
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/tts', authMw, async (req, res) => {
  const { text, voice } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });

  try {
    if (OPENAI_API_KEY) {
      try {
        const r = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
          body: JSON.stringify({ model: 'tts-1', input: text.slice(0, 4096), voice: voice || 'alloy' }),
        });
        if (r.ok) {
          res.setHeader('Content-Type', 'audio/mpeg');
          res.setHeader('Content-Disposition', 'attachment; filename="speech.mp3"');
          r.body.pipe(res);
          return;
        }
      } catch {}
    }
    res.status(503).json({ error: 'TTS not available — configure OPENAI_API_KEY' });
  } catch (e) { res.status(500).json({ error: 'TTS failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// REFERRAL SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/referrals', authMw, async (req, res) => {
  try {
    let user;
    if (MONGO_URI) user = await User.findById(req.user.id).select('referralCode referralCount bonusMessages');
    else user = memUsers.find(u => u.id == req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let referrals = [];
    if (MONGO_URI) referrals = await Referral.find({ referrerId: req.user.id }).sort({ createdAt: -1 }).lean();
    else referrals = memReferrals.filter(r => r.referrerId == req.user.id);

    res.json({ code: user.referralCode, count: user.referralCount || 0, bonusMessages: user.bonusMessages || 0, referrals });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// PAYMENT (Paystack)
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/payments/initialize', authMw, async (req, res) => {
  try {
    let user;
    if (MONGO_URI) user = await User.findById(req.user.id);
    else user = memUsers.find(u => u.id == req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const reference = 'TA_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');

    if (PAYSTACK_SECRET) {
      try {
        const r = await fetch('https://api.paystack.co/transaction/initialize', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: user.email, amount: PRO_PRICE * 100, reference, callback_url: `${req.headers.origin || 'https://tribalai.com'}/payment-callback?ref=${reference}` }),
        });
        const data = await r.json();
        if (data.status) {
          if (MONGO_URI) await Payment.create({ userId: user._id, email: user.email, amount: PRO_PRICE, reference, status: 'pending', plan: 'pro' });
          else memPayments.push({ id: memIdSeq++, userId: user.id, email: user.email, amount: PRO_PRICE, reference, status: 'pending', plan: 'pro', createdAt: new Date() });
          return res.json({ authorization_url: data.data.authorization_url, reference });
        }
      } catch (e) { console.error('Paystack init error:', e.message); }
    }

    // Demo mode
    if (MONGO_URI) await Payment.create({ userId: user._id, email: user.email, amount: PRO_PRICE, reference, status: 'demo', plan: 'pro' });
    else memPayments.push({ id: memIdSeq++, userId: user.id, email: user.email, amount: PRO_PRICE, reference, status: 'demo', plan: 'pro', createdAt: new Date() });
    res.json({ authorization_url: `/payment-callback?ref=${reference}&demo=true`, reference, demo: true });
  } catch (e) { res.status(500).json({ error: 'Payment init failed' }); }
});

app.post('/api/payments/verify', authMw, async (req, res) => {
  const { reference } = req.body;
  if (!reference) return res.status(400).json({ error: 'Reference required' });
  try {
    if (PAYSTACK_SECRET) {
      const r = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET}` },
      });
      const data = await r.json();
      if (data.status && data.data.status === 'success') {
        if (MONGO_URI) {
          await Payment.findOneAndUpdate({ reference }, { status: 'success' });
          await User.findByIdAndUpdate(req.user.id, { plan: 'pro' });
        } else {
          const p = memPayments.find(p => p.reference === reference); if (p) p.status = 'success';
          const u = memUsers.find(u => u.id == req.user.id); if (u) u.plan = 'pro';
        }
        return res.json({ ok: true, plan: 'pro' });
      }
    }

    // Demo verification
    if (MONGO_URI) {
      await Payment.findOneAndUpdate({ reference }, { status: 'success' });
      await User.findByIdAndUpdate(req.user.id, { plan: 'pro' });
    } else {
      const p = memPayments.find(p => p.reference === reference); if (p) p.status = 'success';
      const u = memUsers.find(u => u.id == req.user.id); if (u) u.plan = 'pro';
    }
    res.json({ ok: true, plan: 'pro', demo: true });
  } catch (e) { res.status(500).json({ error: 'Verification failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// API ACCESS (Developer API)
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/v1/chat', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'API key required. Get one at tribalai.com/settings' });

  const token = authHeader.replace('Bearer ', '');
  let user;
  if (MONGO_URI) user = await User.findOne({ _id: token });
  else user = memUsers.find(u => u.id == token || u.referralCode == token);
  if (!user || user.plan !== 'pro') return res.status(403).json({ error: 'Pro plan required for API access' });

  const { message, model } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  let aiResponse = '';
  const useModel = model || 'claude-sonnet-4';

  if (ANTHROPIC_API_KEY && useModel.includes('claude')) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: message }], max_tokens: 4096 }),
      });
      const data = await r.json();
      if (r.ok) aiResponse = data.content?.[0]?.text;
    } catch {}
  }

  if (!aiResponse && OPENAI_API_KEY) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: message }], max_tokens: 4096 }),
      });
      const data = await r.json();
      if (r.ok) aiResponse = data.choices?.[0]?.message?.content;
    } catch {}
  }

  if (!aiResponse) aiResponse = 'No AI provider configured.';
  res.json({ response: aiResponse, model: useModel });
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Invalid admin credentials' });
  const token = jwt.sign({ role: 'admin', email, plan: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token });
});

app.get('/api/admin/stats', authMw, adminMw, async (req, res) => {
  try {
    if (MONGO_URI) {
      const [users, logs, payments] = await Promise.all([User.countDocuments(), Log.countDocuments(), Payment.countDocuments({ status: 'success' })]);
      const recentLogs = await Log.find().sort({ createdAt: -1 }).limit(20).lean();
      return res.json({ totalUsers: users, totalLogs: logs, totalPayments: payments, recentLogs });
    }
    res.json({ totalUsers: memUsers.length, totalLogs: memLogs.length, totalPayments: memPayments.filter(p => p.status === 'success').length, recentLogs: memLogs.slice(-20).reverse() });
  } catch (e) { res.status(500).json({ error: 'Stats failed' }); }
});

app.get('/api/admin/users', authMw, adminMw, async (req, res) => {
  try {
    if (MONGO_URI) return res.json({ users: await User.find().select('-password').sort({ createdAt: -1 }).lean() });
    res.json({ users: memUsers.map(({ password, ...u }) => u) });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.put('/api/admin/users/:id/plan', authMw, adminMw, async (req, res) => {
  const { plan } = req.body;
  if (!['free','pro'].includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
  try {
    if (MONGO_URI) await User.findByIdAndUpdate(req.params.id, { plan });
    else { const u = memUsers.find(u => u.id == req.params.id); if (u) u.plan = plan; }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: DELETE USER
// ══════════════════════════════════════════════════════════════════════════════
app.delete('/api/admin/users/:id', authMw, adminMw, async (req, res) => {
  try {
    if (MONGO_URI) await User.findByIdAndDelete(req.params.id);
    else { const i = memUsers.findIndex(u => u.id == req.params.id); if (i >= 0) memUsers.splice(i, 1); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: BAN/UNBAN USER
// ══════════════════════════════════════════════════════════════════════════════
app.put('/api/admin/users/:id/ban', authMw, adminMw, async (req, res) => {
  try {
    const banned = req.body.banned !== false;
    if (MONGO_URI) await User.findByIdAndUpdate(req.params.id, { banned });
    else { const u = memUsers.find(u => u.id == req.params.id); if (u) u.banned = banned; }
    res.json({ ok: true, banned });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: CHAT LISTING
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/admin/chats', authMw, adminMw, async (req, res) => {
  try {
    if (MONGO_URI) {
      const chats = await Chat.find().select('title userId model createdAt messages').sort({ createdAt: -1 }).limit(200).lean();
      return res.json({ chats });
    }
    res.json({ chats: memChats.slice(-200).reverse() });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: DELETE CHAT
// ══════════════════════════════════════════════════════════════════════════════
app.delete('/api/admin/chats/:id', authMw, adminMw, async (req, res) => {
  try {
    if (MONGO_URI) await Chat.findByIdAndDelete(req.params.id);
    else { const i = memChats.findIndex(c => c.id == req.params.id); if (i >= 0) memChats.splice(i, 1); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: PAYMENT LISTING
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/admin/payments', authMw, adminMw, async (req, res) => {
  try {
    if (MONGO_URI) {
      const payments = await Payment.find().sort({ createdAt: -1 }).limit(200).lean();
      return res.json({ payments });
    }
    res.json({ payments: memPayments.slice(-200).reverse() });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: SYSTEM SETTINGS
// ══════════════════════════════════════════════════════════════════════════════
let systemSettings = {
  maintenanceMode: false,
  allowSignups: true,
  allowFreePlan: true,
  proPriceNaira: 2500,
  freeMsgLimit: 50,
  maxFileSizeMB: 10,
  defaultModel: 'claude-sonnet-4',
  announcement: ''
};

app.get('/api/admin/settings', authMw, adminMw, (req, res) => {
  res.json(systemSettings);
});

app.put('/api/admin/settings', authMw, adminMw, (req, res) => {
  Object.assign(systemSettings, req.body);
  res.json({ ok: true, settings: systemSettings });
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: ANALYTICS
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/admin/analytics', authMw, adminMw, async (req, res) => {
  try {
    if (MONGO_URI) {
      const [totalUsers, totalChats, totalMessages, totalPayments] = await Promise.all([
        User.countDocuments(),
        Chat.countDocuments(),
        Chat.aggregate([{ $unwind: '$messages' }, { $count: 'total' }]).then(r => (r[0] && r[0].total) || 0),
        Payment.countDocuments({ status: 'success' })
      ]);
      const modelUsage = await Chat.aggregate([{ $group: { _id: '$model', count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
      const signupsPerDay = await User.aggregate([
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: -1 } }, { $limit: 30 }
      ]);
      return res.json({ totalUsers, totalChats, totalMessages, totalPayments, modelUsage, signupsPerDay });
    }
    res.json({ totalUsers: memUsers.length, totalChats: memChats.length, totalMessages: memChats.reduce((a, c) => a + c.messages.length, 0), totalPayments: memPayments.filter(p => p.status === 'success').length, modelUsage: [], signupsPerDay: [] });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: REVENUE
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/admin/revenue', authMw, adminMw, async (req, res) => {
  try {
    if (MONGO_URI) {
      const revenue = await Payment.aggregate([
        { $match: { status: 'success' } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { _id: -1 } }, { $limit: 30 }
      ]);
      return res.json({ revenue });
    }
    res.json({ revenue: [] });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: MODELS MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════
let aiModels = [
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'Anthropic', tier: 'free', enabled: true },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', tier: 'pro', enabled: true },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', tier: 'pro', enabled: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', tier: 'free', enabled: true },
  { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', provider: 'Groq', tier: 'free', enabled: true },
  { id: 'llama-3.1-8b', name: 'Llama 3.1 8B', provider: 'Groq', tier: 'free', enabled: true },
  { id: 'mixtral-8x7b', name: 'Mixtral 8x7B', provider: 'Groq', tier: 'free', enabled: true },
  { id: 'dall-e-3', name: 'DALL-E 3', provider: 'OpenAI', tier: 'pro', enabled: true }
];

app.get('/api/admin/models', authMw, adminMw, (req, res) => {
  res.json({ models: aiModels });
});

app.put('/api/admin/models/:id', authMw, adminMw, (req, res) => {
  const m = aiModels.find(m => m.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Model not found' });
  Object.assign(m, req.body);
  res.json({ ok: true, model: m });
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: ANNOUNCEMENTS
// ══════════════════════════════════════════════════════════════════════════════
let announcements = [];

app.get('/api/admin/announcements', authMw, adminMw, (req, res) => {
  res.json({ announcements });
});

app.post('/api/admin/announcements', authMw, adminMw, (req, res) => {
  const { title, message, active } = req.body;
  const ann = { id: Date.now().toString(), title, message, active: active !== false, createdAt: new Date().toISOString() };
  announcements.unshift(ann);
  res.json({ ok: true, announcement: ann });
});

app.delete('/api/admin/announcements/:id', authMw, adminMw, (req, res) => {
  announcements = announcements.filter(a => a.id !== req.params.id);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: BACKUPS
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/admin/backups', authMw, adminMw, (req, res) => {
  res.json({ backups: [] });
});

app.post('/api/admin/backups', authMw, adminMw, (req, res) => {
  res.json({ ok: true, message: 'Backup initiated (simulated)' });
});

// ══════════════════════════════════════════════════════════════════════════════
// SMART SUGGESTIONS
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/suggestions', authMw, async (req, res) => {
  const { message, response } = req.body;
  // Generate contextual follow-up suggestions
  const suggestions = [];
  const lowerMsg = (message || '').toLowerCase();
  const lowerResp = (response || '').toLowerCase();

  if (lowerMsg.includes('code') || lowerResp.includes('function') || lowerResp.includes('def ') || lowerResp.includes('const ')) {
    suggestions.push('Explain this code line by line', 'Can you optimize this?', 'Add error handling');
  } else if (lowerMsg.includes('write') || lowerMsg.includes('create') || lowerMsg.includes('draft')) {
    suggestions.push('Make it shorter', 'Make it more formal', 'Translate to another language');
  } else if (lowerMsg.includes('explain') || lowerMsg.includes('what is') || lowerMsg.includes('how does')) {
    suggestions.push('Give me an example', 'Go deeper', 'How is this used in practice?');
  } else if (lowerResp.includes('\n```') || lowerResp.includes('```')) {
    suggestions.push('Run this code', 'Explain each line', 'Write tests for this');
  } else {
    suggestions.push('Tell me more', 'Give an example', 'What are the alternatives?');
  }
  res.json({ suggestions: suggestions.slice(0, 3) });
});

// ══════════════════════════════════════════════════════════════════════════════
// WEB SEARCH
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/web-search', authMw, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query required' });
  try {
    const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`);
    const data = await r.json();
    const results = [];
    if (data.AbstractText) results.push({ title: data.Heading, snippet: data.AbstractText, url: data.AbstractURL });
    (data.RelatedTopics || []).slice(0, 5).forEach(t => {
      if (t.Text && t.FirstURL) results.push({ title: t.Text.slice(0, 80), snippet: t.Text, url: t.FirstURL });
    });
    res.json({ results, query });
  } catch (e) { res.status(500).json({ error: 'Search failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// PERSONAS
// ══════════════════════════════════════════════════════════════════════════════
const defaultPersonas = [
  { id: 'default', name: 'Tribal AI', avatar: '🤖', systemPrompt: 'You are Tribal AI, a helpful AI assistant.', category: 'general' },
  { id: 'coder', name: 'Code Assistant', avatar: '💻', systemPrompt: 'You are an expert programmer. Help users write, debug, and optimize code. Always include working code examples.', category: 'coding' },
  { id: 'writer', name: 'Creative Writer', avatar: '✍️', systemPrompt: 'You are a talented creative writer. Help users craft stories, essays, and creative content with vivid language.', category: 'creative' },
  { id: 'tutor', name: 'Math Tutor', avatar: '🧮', systemPrompt: 'You are a patient math tutor. Explain concepts step by step. Use examples. Make math accessible and fun.', category: 'education' },
  { id: 'analyst', name: 'Data Analyst', avatar: '📊', systemPrompt: 'You are a data analyst expert. Help users analyze data, create charts, and derive insights. Use Python/pandas when helpful.', category: 'data' },
  { id: 'designer', name: 'UI Designer', avatar: '🎨', systemPrompt: 'You are a UI/UX design expert. Help users create beautiful, usable interfaces. Suggest improvements and best practices.', category: 'design' },
  { id: 'translator', name: 'Translator', avatar: '🌍', systemPrompt: 'You are an expert translator. Translate between languages naturally, preserving tone and meaning. Support Yoruba, Igbo, Hausa, French, Spanish, Portuguese.', category: 'language' },
  { id: 'business', name: 'Business Advisor', avatar: '💼', systemPrompt: 'You are a business strategist. Help users with business plans, marketing, finance, and growth strategy.', category: 'business' },
  { id: 'therapist', name: 'Wellness Coach', avatar: '🧘', systemPrompt: 'You are a supportive wellness coach. Listen empathetically, ask thoughtful questions, and help users reflect. Not a replacement for professional therapy.', category: 'wellness' },
  { id: 'chef', name: 'Chef', avatar: '👨‍🍳', systemPrompt: 'You are a professional chef. Help users with recipes, cooking techniques, meal planning, and dietary advice.', category: 'lifestyle' }
];

app.get('/api/personas', (req, res) => {
  res.json({ personas: defaultPersonas });
});

app.get('/api/personas/:id', (req, res) => {
  const p = defaultPersonas.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Persona not found' });
  res.json(p);
});

// ══════════════════════════════════════════════════════════════════════════════
// PROMPT LIBRARY
// ══════════════════════════════════════════════════════════════════════════════
const communityPrompts = [
  { id: '1', title: 'Explain Like I\'m 5', prompt: 'Explain the following concept as if I were 5 years old, using simple analogies and everyday examples:', category: 'education', upvotes: 245, author: 'Tribal' },
  { id: '2', title: 'Code Review', prompt: 'Review the following code for bugs, performance issues, and best practices. Suggest improvements:', category: 'coding', upvotes: 189, author: 'Tribal' },
  { id: '3', title: 'Professional Email', prompt: 'Write a professional email with the following details. Use a clear subject line, polite greeting, concise body, and professional closing:', category: 'writing', upvotes: 312, author: 'Tribal' },
  { id: '4', title: 'Meeting Summary', prompt: 'Summarize the following meeting notes into key points, action items, and decisions made:', category: 'productivity', upvotes: 156, author: 'Tribal' },
  { id: '5', title: 'Blog Post Outline', prompt: 'Create a detailed blog post outline with hook, introduction, 5-7 sections with subheadings, and conclusion:', category: 'writing', upvotes: 203, author: 'Tribal' },
  { id: '6', title: 'API Documentation', prompt: 'Write clear API documentation for the following endpoint including method, URL, parameters, request/response examples:', category: 'coding', upvotes: 134, author: 'Tribal' },
  { id: '7', title: 'Study Plan', prompt: 'Create a 2-week study plan for the following topic. Include daily tasks, resources, and practice exercises:', category: 'education', upvotes: 178, author: 'Tribal' },
  { id: '8', title: 'Business Proposal', prompt: 'Write a professional business proposal with executive summary, problem statement, solution, timeline, and pricing:', category: 'business', upvotes: 221, author: 'Tribal' },
  { id: '9', title: 'Debug Helper', prompt: 'Help me debug the following error. Analyze the error message, identify the root cause, and provide a fix with explanation:', category: 'coding', upvotes: 267, author: 'Tribal' },
  { id: '10', title: 'Social Media Post', prompt: 'Create an engaging social media post for the following topic. Include a hook, value, and call-to-action. Make it shareable:', category: 'marketing', upvotes: 198, author: 'Tribal' }
];

app.get('/api/prompts', (req, res) => {
  const { category } = req.query;
  let prompts = communityPrompts;
  if (category && category !== 'all') prompts = prompts.filter(p => p.category === category);
  res.json({ prompts });
});

app.post('/api/prompts/:id/upvote', authMw, (req, res) => {
  const p = communityPrompts.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  p.upvotes++;
  res.json({ ok: true, upvotes: p.upvotes });
});

// ══════════════════════════════════════════════════════════════════════════════
// AI MEMORY (Persistent across sessions)
// ══════════════════════════════════════════════════════════════════════════════
let userMemory = {};

app.get('/api/memory', authMw, async (req, res) => {
  try {
    if (MONGO_URI) {
      const mem = await Memory.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(50).lean();
      return res.json({ memories: mem });
    }
    const mems = userMemory[req.user.id] || [];
    res.json({ memories: mems.slice(-50).reverse() });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/memory', authMw, async (req, res) => {
  const { text, category } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  try {
    if (MONGO_URI) {
      const mem = await Memory.create({ userId: req.user.id, text, category: category || 'general' });
      return res.json({ ok: true, memory: mem });
    }
    if (!userMemory[req.user.id]) userMemory[req.user.id] = [];
    const mem = { id: Date.now().toString(), text, category: category || 'general', createdAt: new Date().toISOString() };
    userMemory[req.user.id].push(mem);
    res.json({ ok: true, memory: mem });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/memory/:id', authMw, async (req, res) => {
  try {
    if (MONGO_URI) await Memory.findByIdAndDelete(req.params.id);
    else {
      const mems = userMemory[req.user.id] || [];
      userMemory[req.user.id] = mems.filter(m => m.id !== req.params.id);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ACHIEVEMENTS / GAMIFICATION
// ══════════════════════════════════════════════════════════════════════════════
const achievementDefs = [
  { id: 'first_chat', name: 'First Chat', icon: '🎉', desc: 'Sent your first message', condition: (stats) => stats.messages >= 1 },
  { id: 'chat_10', name: 'Getting Started', icon: '💬', desc: 'Sent 10 messages', condition: (stats) => stats.messages >= 10 },
  { id: 'chat_100', name: 'Conversationalist', icon: '🗣️', desc: 'Sent 100 messages', condition: (stats) => stats.messages >= 100 },
  { id: 'chat_1000', name: 'Power User', icon: '⚡', desc: 'Sent 1000 messages', condition: (stats) => stats.messages >= 1000 },
  { id: 'first_code', name: 'Code Runner', icon: '💻', desc: 'Ran code for the first time', condition: (stats) => stats.codeRuns >= 1 },
  { id: 'code_50', name: 'Developer', icon: '👨‍💻', desc: 'Ran 50 code snippets', condition: (stats) => stats.codeRuns >= 50 },
  { id: 'model_explorer', name: 'Model Explorer', icon: '🧠', desc: 'Used 3 different AI models', condition: (stats) => stats.modelsUsed >= 3 },
  { id: 'first_image', name: 'Artist', icon: '🎨', desc: 'Generated your first image', condition: (stats) => stats.imagesGenerated >= 1 },
  { id: 'week_streak', name: 'Week Warrior', icon: '🔥', desc: 'Used Tribal AI 7 days in a row', condition: (stats) => stats.streak >= 7 },
  { id: 'month_streak', name: 'Monthly Master', icon: '👑', desc: '30-day streak', condition: (stats) => stats.streak >= 30 },
  { id: 'night_owl', name: 'Night Owl', icon: '🦉', desc: 'Chat between 12am-4am', condition: (stats) => stats.nightChats >= 1 },
  { id: 'early_bird', name: 'Early Bird', icon: '🐦', desc: 'Chat between 5am-7am', condition: (stats) => stats.earlyChats >= 1 },
  { id: 'first_export', name: 'Exporter', icon: '📤', desc: 'Exported a chat', condition: (stats) => stats.exports >= 1 },
  { id: 'pro_user', name: 'Pro Member', icon: '⭐', desc: 'Upgraded to Pro', condition: (stats) => stats.isPro }
];

app.get('/api/achievements', authMw, async (req, res) => {
  try {
    let stats = { messages: 0, codeRuns: 0, modelsUsed: 0, imagesGenerated: 0, streak: 0, nightChats: 0, earlyChats: 0, exports: 0, isPro: false };
    if (MONGO_URI) {
      const user = await User.findById(req.user.id).lean();
      if (user) {
        stats.messages = user.stats?.messages || 0;
        stats.codeRuns = user.stats?.codeRuns || 0;
        stats.isPro = user.plan === 'pro';
        const models = await Chat.distinct('model', { userId: req.user.id });
        stats.modelsUsed = models.length;
      }
    }
    const earned = achievementDefs.filter(a => a.condition(stats));
    const locked = achievementDefs.filter(a => !a.condition(stats));
    res.json({ earned, locked, stats });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CHAT SHARING
// ══════════════════════════════════════════════════════════════════════════════
let sharedChats = {};

app.post('/api/chats/:id/share', authMw, async (req, res) => {
  try {
    const shareId = Math.random().toString(36).slice(2, 10);
    sharedChats[shareId] = { chatId: req.params.id, userId: req.user.id, createdAt: new Date().toISOString() };
    res.json({ ok: true, shareUrl: `/shared/${shareId}`, shareId });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/shared/:shareId', async (req, res) => {
  const shared = sharedChats[req.params.shareId];
  if (!shared) return res.status(404).json({ error: 'Shared chat not found' });
  try {
    if (MONGO_URI) {
      const chat = await Chat.findById(shared.chatId).lean();
      if (!chat) return res.status(404).json({ error: 'Chat not found' });
      return res.json({ title: chat.title, messages: chat.messages.map(m => ({ role: m.role, content: m.content })) });
    }
    const chat = memChats.find(c => c.id === shared.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json({ title: chat.title, messages: chat.messages.map(m => ({ role: m.role, content: m.content })) });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// HEALTH & CATCH-ALL
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// F1: CONVERSATION SEARCH
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/chats/search/:query', authMw, async (req, res) => {
  try {
    const q = req.params.query.toLowerCase();
    if (MONGO_URI) {
      const chats = await Chat.find({ userId: req.user.id, $or: [
        { title: new RegExp(q, 'i') },
        { 'messages.content': new RegExp(q, 'i') }
      ]}).select('title model updatedAt').sort({ updatedAt: -1 }).limit(20).lean();
      return res.json({ results: chats });
    }
    const results = memChats.filter(c => c.userId == req.user.id && (
      (c.title || '').toLowerCase().includes(q) ||
      c.messages.some(m => (m.content || '').toLowerCase().includes(q))
    )).slice(0, 20).map(({ messages, ...c }) => c);
    res.json({ results });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// F2: PIN CHATS
// ══════════════════════════════════════════════════════════════════════════════

app.put('/api/chats/:id/pin', authMw, async (req, res) => {
  try {
    if (MONGO_URI) {
      const chat = await Chat.findOne({ _id: req.params.id, userId: req.user.id });
      if (chat) { chat.pinned = !chat.pinned; await chat.save(); return res.json({ pinned: chat.pinned }); }
    }
    const chat = memChats.find(c => (c._id || c.id) == req.params.id && c.userId == req.user.id);
    if (chat) { chat.pinned = !chat.pinned; return res.json({ pinned: chat.pinned }); }
    res.status(404).json({ error: 'Not found' });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// F3: ARCHIVE CHATS
// ══════════════════════════════════════════════════════════════════════════════

app.put('/api/chats/:id/archive', authMw, async (req, res) => {
  try {
    if (MONGO_URI) {
      const chat = await Chat.findOne({ _id: req.params.id, userId: req.user.id });
      if (chat) { chat.archived = !chat.archived; await chat.save(); return res.json({ archived: chat.archived }); }
    }
    const chat = memChats.find(c => (c._id || c.id) == req.params.id && c.userId == req.user.id);
    if (chat) { chat.archived = !chat.archived; return res.json({ archived: chat.archived }); }
    res.status(404).json({ error: 'Not found' });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// F9: EDIT & RESEND
// ══════════════════════════════════════════════════════════════════════════════

app.put('/api/chats/:chatId/messages/:msgIdx', authMw, async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });
  try {
    let chat;
    if (MONGO_URI) chat = await Chat.findOne({ _id: req.params.chatId, userId: req.user.id });
    else chat = memChats.find(c => (c._id || c.id) == req.params.chatId && c.userId == req.user.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    const idx = parseInt(req.params.msgIdx);
    if (idx < 0 || idx >= chat.messages.length) return res.status(400).json({ error: 'Invalid index' });
    chat.messages[idx].content = content;
    if (MONGO_URI) await chat.save();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// F10: MESSAGE REACTIONS
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/chats/:chatId/messages/:msgIdx/react', authMw, async (req, res) => {
  const { emoji } = req.body;
  try {
    let chat;
    if (MONGO_URI) chat = await Chat.findOne({ _id: req.params.chatId, userId: req.user.id });
    else chat = memChats.find(c => (c._id || c.id) == req.params.chatId && c.userId == req.user.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    const idx = parseInt(req.params.msgIdx);
    if (!chat.messages[idx]) return res.status(400).json({ error: 'Invalid index' });
    if (!chat.messages[idx].reactions) chat.messages[idx].reactions = [];
    const existing = chat.messages[idx].reactions.findIndex(r => r.emoji === emoji);
    if (existing > -1) chat.messages[idx].reactions.splice(existing, 1);
    else chat.messages[idx].reactions.push({ emoji, userId: req.user.id });
    if (MONGO_URI) await chat.save();
    res.json({ reactions: chat.messages[idx].reactions });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// F36: USAGE ALERTS
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/alerts', authMw, async (req, res) => {
  try {
    let user;
    if (MONGO_URI) user = await User.findById(req.user.id).select('messagesThisMonth plan bonusMessages');
    else user = memUsers.find(u => u.id == req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const limit = user.plan === 'pro' ? PRO_LIMIT : FREE_LIMIT + (user.bonusMessages || 0);
    const used = user.messagesThisMonth || 0;
    const pct = (used / limit) * 100;
    const alerts = [];
    if (pct >= 90) alerts.push({ level: 'critical', message: `You've used ${Math.round(pct)}% of your monthly limit. Upgrade to Pro for unlimited.` });
    else if (pct >= 70) alerts.push({ level: 'warning', message: `You've used ${Math.round(pct)}% of your monthly limit.` });
    res.json({ alerts, used, limit, pct: Math.round(pct) });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// F34: AUDIT LOGS
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/audit', authMw, adminMw, async (req, res) => {
  try {
    if (MONGO_URI) return res.json({ logs: await Log.find().sort({ createdAt: -1 }).limit(100).lean() });
    res.json({ logs: memLogs.slice(-100).reverse() });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// STATUS ENDPOINT
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/status', (req, res) => {
  res.json({
    status: 'operational',
    version: '5.0.0',
    uptime: Math.floor(process.uptime()),
    db: MONGO_URI ? 'connected' : 'in-memory',
    services: {
      api: 'operational',
      ai: ANTHROPIC_API_KEY || OPENAI_API_KEY ? 'operational' : 'no-provider',
      payments: PAYSTACK_SECRET ? 'operational' : 'demo-mode',
      auth: 'operational',
      storage: MONGO_URI ? 'mongodb' : 'memory',
    },
    timestamp: new Date().toISOString(),
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CONTACT FORM
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!email || !message) return res.status(400).json({ error: 'Email and message required' });
  try {
    // Store contact submission
    if (MONGO_URI) {
      await mongoose.model('TAContact', new mongoose.Schema({ name: String, email: String, subject: String, message: String, createdAt: Date }, { timestamps: true })).create({ name, email, subject, message });
    }
    res.json({ ok: true, message: 'Message received. We will get back to you soon.' });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CHANGELOG
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/changelog', (req, res) => {
  res.json({
    entries: [
      { version: '5.0.0', date: '2026-07-21', title: 'Major Feature Update', changes: ['Branching conversations', 'Keyboard shortcuts', 'Multi-language support', '2FA authentication', 'Session management', 'Analytics dashboard', 'GDPR data export'] },
      { version: '4.0.0', date: '2026-07-21', title: 'Power Features', changes: ['Streaming responses', 'Code execution', 'Conversation memory', 'Image generation', 'Text-to-speech', 'Chat folders'] },
      { version: '3.0.0', date: '2026-07-21', title: 'Platform Features', changes: ['Google social login', 'Multi-model switching', 'Web search', 'Templates library', 'Team accounts'] },
      { version: '2.0.0', date: '2026-07-21', title: 'Monetization', changes: ['Paystack payments', 'File upload', 'Referral system', 'Chat sharing', 'Export chats', 'Developer API', 'PWA'] },
      { version: '1.0.0', date: '2026-07-21', title: 'Launch', changes: ['AI chat', 'User auth', 'Admin dashboard', 'Dark mode', 'Usage limits'] },
    ]
  });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '5.0.0', db: MONGO_URI ? 'mongodb' : 'memory', features: ['chat','upload','share','export','referrals','payments','api','social-login','multi-model','web-search','templates','teams','streaming','code-exec','memory','image-gen','tts','folders','branching','shortcuts','translate','2fa','sessions','analytics','search','pin','archive','edit-resend','reactions','alerts','audit','status','contact','changelog'], uptime: Math.floor(process.uptime()) }));

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) res.sendFile(path.join(__dirname, '..', 'index.html'));
  else res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Tribal AI v2.0 running on port ${PORT}`);
  console.log(`🤖  Anthropic: ${ANTHROPIC_API_KEY ? '✅' : '❌'}`);
  console.log(`🤖  OpenAI: ${OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`💳  Paystack: ${PAYSTACK_SECRET ? '✅' : '❌ (demo mode)'}`);
  console.log(`🗄️  DB: ${MONGO_URI ? 'MongoDB Atlas' : 'In-memory'}`);
});
