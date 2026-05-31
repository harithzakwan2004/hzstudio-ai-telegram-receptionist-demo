import 'dotenv/config';
import express from 'express';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.use(express.json());

const {
  TELEGRAM_BOT_TOKEN,
  GEMINI_API_KEY,
  CLINIC_NAME = 'the dental clinic',
  CLINIC_LOCATION = 'our clinic location',
  CLINIC_HOURS = 'our usual clinic hours',
  CLINIC_PHONE = 'the clinic phone number',
  APPS_SCRIPT_WEBHOOK_URL,
  INQUIRY_SHARED_SECRET,
  PORT = 3000
} = process.env;

if (!TELEGRAM_BOT_TOKEN) {
  console.warn('Missing TELEGRAM_BOT_TOKEN. Telegram replies will not work until it is set.');
}

if (!GEMINI_API_KEY) {
  console.warn('Missing GEMINI_API_KEY. AI replies will use the fallback message until it is set.');
}

if (!APPS_SCRIPT_WEBHOOK_URL || !INQUIRY_SHARED_SECRET) {
  console.warn('Missing Google Sheet bridge settings. Appointment requests will not be saved until they are set.');
}

const gemini = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

const SYSTEM_PROMPT =
  'You are an AI receptionist for a dental clinic. Be friendly, clear, professional, and concise. Your job is to answer common questions, collect appointment details, and hand off to staff when needed. Do not diagnose medical conditions. Do not guarantee treatment prices. Do not confirm appointments. If the customer has severe pain, bleeding, swelling, injury, or urgent symptoms, advise them to contact the clinic immediately or seek emergency care.';

const SERVICES = [
  'Dental check-up and consultation',
  'Scaling and polishing',
  'Fillings',
  'Tooth extraction',
  'Root canal treatment',
  'Teeth whitening',
  'Braces or clear aligner consultation',
  'Crowns, bridges, and dentures'
];

const chatMemory = {};

function emptyAppointment() {
  return {
    name: '',
    preferredDateTime: '',
    treatment: '',
    phone: ''
  };
}

function getChatState(chatId) {
  if (!chatMemory[chatId]) {
    chatMemory[chatId] = {
      messages: [],
      collectingAppointment: false,
      appointment: emptyAppointment()
    };
  }

  return chatMemory[chatId];
}

function resetChatState(chatId) {
  delete chatMemory[chatId];
}

function welcomeMessage() {
  return [
    `Hello! Welcome to ${CLINIC_NAME}. I am the AI receptionist demo for HZStudio AI.`,
    '',
    'How can I help you today?',
    '',
    '1. Opening hours',
    '2. Clinic location',
    '3. Dental services',
    '4. Book an appointment',
    '5. Pricing question',
    '6. Talk to human staff',
    '',
    'You can type your question naturally, or use /demo to learn about this demo.'
  ].join('\n');
}

function demoMessage() {
  return [
    'This is a demo AI receptionist for dental clinics by HZStudio AI.',
    '',
    'It can answer common questions, collect appointment requests, explain basic clinic info, and hand off to human staff. For production, this same idea can later be moved to WhatsApp or WATI.'
  ].join('\n');
}

function appointmentSummary(appointment) {
  return [
    'Thanks. I have collected your appointment request:',
    '',
    `Name: ${appointment.name}`,
    `Preferred date/time: ${appointment.preferredDateTime}`,
    `Treatment needed: ${appointment.treatment}`,
    `Phone number: ${appointment.phone}`,
    '',
    'This appointment is not confirmed yet. Our clinic staff will contact you to confirm availability.'
  ].join('\n');
}

function missingAppointmentFields(appointment) {
  const missing = [];

  if (!appointment.name) missing.push('your name');
  if (!appointment.preferredDateTime) missing.push('your preferred date and time');
  if (!appointment.treatment) missing.push('the treatment you need');
  if (!appointment.phone) missing.push('your phone number');

  return missing;
}

function nextAppointmentQuestion(appointment) {
  const missing = missingAppointmentFields(appointment);

  if (missing.length === 0) {
    return appointmentSummary(appointment);
  }

  return `Sure, I can help collect an appointment request. Please share ${missing[0]}.`;
}

function updateAppointmentFromText(appointment, text, options = {}) {
  let updatedFields = 0;
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const [rawKey, ...rawValue] = line.split(':');
    if (!rawKey || rawValue.length === 0) continue;

    const key = rawKey.toLowerCase();
    const value = rawValue.join(':').trim();
    if (!value) continue;

    if (key.includes('name')) {
      appointment.name = value;
      updatedFields += 1;
    }
    if (key.includes('date') || key.includes('time') || key.includes('preferred')) {
      appointment.preferredDateTime = value;
      updatedFields += 1;
    }
    if (key.includes('treatment') || key.includes('service')) {
      appointment.treatment = value;
      updatedFields += 1;
    }
    if (key.includes('phone') || key.includes('contact') || key.includes('mobile')) {
      appointment.phone = value;
      updatedFields += 1;
    }
  }

  const phoneMatch = text.match(/(?:\+?\d[\d\s-]{7,}\d)/);
  if (phoneMatch && !appointment.phone) {
    appointment.phone = phoneMatch[0].trim();
    updatedFields += 1;
  }

  // During appointment collection, allow simple one-message-at-a-time replies.
  if (options.sequential && updatedFields === 0) {
    const missing = missingAppointmentFields(appointment);
    const value = text.trim();

    if (missing[0] === 'your name') appointment.name = value;
    if (missing[0] === 'your preferred date and time') appointment.preferredDateTime = value;
    if (missing[0] === 'the treatment you need') appointment.treatment = value;
    if (missing[0] === 'your phone number') appointment.phone = value;
  }
}

function looksLikeAppointmentRequest(text) {
  return /appointment|book|booking|schedule|visit|slot|see dentist/i.test(text);
}

function beginAppointmentCollection(state) {
  if (missingAppointmentFields(state.appointment).length === 0) {
    state.appointment = emptyAppointment();
  }

  state.collectingAppointment = true;
}

function isUrgentMessage(text) {
  return /severe pain|bleeding|swelling|swollen|injury|accident|trauma|emergency|urgent|cannot breathe|fever/i.test(text);
}

function quickReply(text, state) {
  const lowerText = text.toLowerCase();

  if (/^(hi|hello|hey|hai|salam|assalam|good morning|good afternoon|good evening)\b/i.test(lowerText)) {
    return `Hello! Welcome to ${CLINIC_NAME}. I can help with opening hours, location, services, pricing questions, appointment requests, or connect you with staff.`;
  }

  if (/why|what happened|not working|problem|error/i.test(lowerText)) {
    return 'I am here to help. You can ask about clinic hours, location, dental services, pricing, or say "book appointment" and I will collect your details for staff to confirm.';
  }

  if (lowerText === '1') {
    return `${CLINIC_NAME} opening hours: ${CLINIC_HOURS}.`;
  }

  if (lowerText === '2') {
    return `${CLINIC_NAME} is located at ${CLINIC_LOCATION}.`;
  }

  if (lowerText === '3') {
    return `Common services include:\n- ${SERVICES.join('\n- ')}`;
  }

  if (lowerText === '4') {
    beginAppointmentCollection(state);
    return nextAppointmentQuestion(state.appointment);
  }

  if (lowerText === '5') {
    return 'Prices depend on the treatment, case complexity, and dentist assessment. I can share general guidance, but final pricing must be confirmed by clinic staff after consultation.';
  }

  if (lowerText === '6') {
    return `Of course. Please call ${CLINIC_NAME} at ${CLINIC_PHONE}, or leave your name, phone number, and question here so staff can follow up.`;
  }

  if (isUrgentMessage(text)) {
    return `I am sorry to hear that. If you have severe pain, bleeding, swelling, injury, or urgent symptoms, please contact ${CLINIC_NAME} immediately at ${CLINIC_PHONE} or seek emergency care.`;
  }

  if (/hour|open|close|time/i.test(text)) {
    return `${CLINIC_NAME} opening hours: ${CLINIC_HOURS}.`;
  }

  if (/location|address|where|map/i.test(text)) {
    return `${CLINIC_NAME} is located at ${CLINIC_LOCATION}.`;
  }

  if (/service|treatment|do you do|offer/i.test(text)) {
    return `Common services include:\n- ${SERVICES.join('\n- ')}\n\nIf you are unsure what you need, our dentist can advise after checking your condition.`;
  }

  if (/price|pricing|cost|how much|fee|rm\b/i.test(lowerText)) {
    return 'Prices depend on the treatment, case complexity, and dentist assessment. I can share general guidance, but final pricing must be confirmed by clinic staff after consultation.';
  }

  if (/human|staff|person|call me|receptionist/i.test(text)) {
    return `Of course. Please call ${CLINIC_NAME} at ${CLINIC_PHONE}, or leave your name, phone number, and question here so staff can follow up.`;
  }

  if (looksLikeAppointmentRequest(text)) {
    beginAppointmentCollection(state);
    updateAppointmentFromText(state.appointment, text);
    return nextAppointmentQuestion(state.appointment);
  }

  return null;
}

function rememberMessage(state, role, content) {
  state.messages.push({ role, content });

  // Keep memory small because this demo stores chat history only in server RAM.
  if (state.messages.length > 12) {
    state.messages = state.messages.slice(-12);
  }
}

function clinicContext() {
  return [
    `Clinic name: ${CLINIC_NAME}`,
    `Clinic location: ${CLINIC_LOCATION}`,
    `Clinic hours: ${CLINIC_HOURS}`,
    `Clinic phone: ${CLINIC_PHONE}`,
    `Available services: ${SERVICES.join(', ')}`,
    '',
    'Appointment details to collect: customer name, preferred date/time, treatment needed, and phone number.',
    'Always say that staff will confirm appointment availability. Never say an appointment is confirmed.',
    'When unsure, ask a short clarifying question or offer to hand off to staff.'
  ].join('\n');
}

async function generateAiReply(state, userText) {
  if (!gemini) {
    return `Thanks for your message. I can help with hours, location, services, appointment requests, or hand off to staff at ${CLINIC_PHONE}.`;
  }

  const history = state.messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }]
  }));

  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      ...history,
      {
        role: 'user',
        parts: [{ text: userText }]
      }
    ],
    config: {
      systemInstruction: `${SYSTEM_PROMPT}\n\n${clinicContext()}`,
      temperature: 0.4,
      maxOutputTokens: 350
    }
  });

  return response.text?.trim() || 'Sorry, I am not sure about that. Would you like me to hand this over to our clinic staff?';
}

function telegramContact(message) {
  const username = message.from?.username ? `@${message.from.username}` : '';
  const displayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ');

  return [username, displayName].filter(Boolean).join(' / ') || `Chat ID ${message.chat.id}`;
}

async function saveAppointmentLead(message, appointment) {
  if (!APPS_SCRIPT_WEBHOOK_URL || !INQUIRY_SHARED_SECRET) {
    console.warn('Appointment collected but Google Sheet bridge settings are missing.');
    return;
  }

  const lead = {
    capturedAt: new Date().toISOString(),
    customerName: appointment.name,
    whatsappNumber: appointment.phone,
    inquiryType: 'Appointment Request',
    treatment: appointment.treatment,
    preferredDate: appointment.preferredDateTime,
    status: 'New',
    source: 'Telegram'
  };
  const note = `Telegram demo booking from ${telegramContact(message)}.`;

  try {
    const response = await fetch(APPS_SCRIPT_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        secret: INQUIRY_SHARED_SECRET,
        lead,
        note
      })
    });

    if (!response.ok) {
      throw new Error(`Google Sheet bridge returned ${response.status}: ${await response.text()}`);
    }

    const result = await response.json();
    if (!result.ok) {
      throw new Error(`Google Sheet bridge rejected the lead: ${JSON.stringify(result)}`);
    }

    console.log(`Saved Telegram appointment request for ${appointment.name}.`);
  } catch (error) {
    // Keep the patient-facing demo responsive if the Sheet bridge is temporarily unavailable.
    console.error('Google Sheet lead save failed:', error);
  }
}

async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log(`Telegram token missing. Reply for chat ${chatId}: ${text}`);
    return;
  }

  const response = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram sendMessage failed: ${errorText}`);
  }
}

async function handleTelegramMessage(message) {
  const chatId = message.chat.id;
  const userText = message.text?.trim();

  if (!userText) {
    await sendTelegramMessage(chatId, 'Please send a text message so I can help you.');
    return;
  }

  if (userText.startsWith('/start')) {
    getChatState(chatId);
    await sendTelegramMessage(chatId, welcomeMessage());
    return;
  }

  if (userText.startsWith('/reset')) {
    resetChatState(chatId);
    await sendTelegramMessage(chatId, 'Conversation memory has been reset. You can type /start to begin again.');
    return;
  }

  if (userText.startsWith('/demo')) {
    await sendTelegramMessage(chatId, demoMessage());
    return;
  }

  const state = getChatState(chatId);

  if (state.collectingAppointment) {
    updateAppointmentFromText(state.appointment, userText, { sequential: true });
    const reply = nextAppointmentQuestion(state.appointment);

    if (missingAppointmentFields(state.appointment).length === 0) {
      state.collectingAppointment = false;
      await saveAppointmentLead(message, state.appointment);
    }

    rememberMessage(state, 'user', userText);
    rememberMessage(state, 'assistant', reply);
    await sendTelegramMessage(chatId, reply);
    return;
  }

  const quickResponse = quickReply(userText, state);
  if (quickResponse) {
    rememberMessage(state, 'user', userText);
    rememberMessage(state, 'assistant', quickResponse);
    await sendTelegramMessage(chatId, quickResponse);
    return;
  }

  try {
    const aiReply = await generateAiReply(state, userText);
    rememberMessage(state, 'user', userText);
    rememberMessage(state, 'assistant', aiReply);
    await sendTelegramMessage(chatId, aiReply);
  } catch (error) {
    console.error('AI reply failed:', error);
    const fallbackReply =
      quickReply(userText, state) ||
      `Thanks for your message. I can help with clinic hours, location, services, pricing, appointment requests, or human staff handoff. If you want to book, please send your name, preferred date/time, treatment needed, and phone number.`;

    rememberMessage(state, 'user', userText);
    rememberMessage(state, 'assistant', fallbackReply);
    await sendTelegramMessage(chatId, fallbackReply);
  }
}

async function handleTelegramMessageOld(message) {
  const chatId = message.chat.id;
  try {
    await handleTelegramMessage(message);
  } catch (error) {
    console.error('Telegram message fallback failed:', error);
    await sendTelegramMessage(
      chatId,
      `Sorry, I am having trouble replying right now. Please contact ${CLINIC_NAME} directly at ${CLINIC_PHONE}, or leave your name and phone number for staff follow-up.`
    );
  }
}

app.get('/', (req, res) => {
  res.send('Telegram AI receptionist demo is running.');
});

app.post('/telegram/webhook', async (req, res) => {
  res.sendStatus(200);

  const message = req.body?.message;
  if (!message) return;

  try {
    await handleTelegramMessageOld(message);
  } catch (error) {
    console.error('Telegram webhook handling failed:', error);
  }
});

app.listen(PORT, () => {
  console.log(`Telegram AI receptionist demo is running on port ${PORT}.`);
});
