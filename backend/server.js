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
  lastActive: { type: Date, default: Date.now },
}, { timestamps: true });

const ChatSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'TAUser', required: true },
  title:    { type: String, default: 'New Chat' },
  model:    { type: String, default: 'claude-sonnet-4' },
  shared:   { type: Boolean, default: false },
  shareId:  { type: String, default: '' },
  messages: [{
    role:      { type: String, enum: ['user', 'assistant', 'system'] },
    content:   { type: String },
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

const User    = mongoose.models.TAUser   || mongoose.model('TAUser',   UserSchema);
const Chat    = mongoose.models.TAChat   || mongoose.model('TAChat',   ChatSchema);
const Log     = mongoose.models.TALog    || mongoose.model('TALog',    LogSchema);
const Referral = mongoose.models.TAReferral || mongoose.model('TAReferral', ReferralSchema);
const Payment = mongoose.models.TAPayment || mongoose.model('TAPayment', PaymentSchema);
const Team    = mongoose.models.TATeam   || mongoose.model('TATeam', TeamSchema);
const Template = mongoose.models.TATemplate || mongoose.model('TATemplate', TemplateSchema);

// ── In-memory fallback ───────────────────────────────────────────────────────
const memUsers = [], memChats = [], memLogs = [], memReferrals = [], memPayments = [], memTeams = [], memTemplates = [];
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
// HEALTH & CATCH-ALL
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '3.0.0', db: MONGO_URI ? 'mongodb' : 'memory', features: ['chat','upload','share','export','referrals','payments','api','social-login','multi-model','web-search','templates','teams'], uptime: Math.floor(process.uptime()) }));

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
