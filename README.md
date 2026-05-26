# HZStudio AI Telegram Receptionist Demo

A simple Telegram bot demo that acts like an AI receptionist for a dental clinic. It uses Node.js, Express, Telegram Bot API, and the official Google Gemini Node SDK.

This demo can answer common clinic questions, collect appointment requests, and hand off to human staff. It does not confirm appointments, diagnose conditions, or guarantee prices.

## File Structure

```text
.
+-- .env.example
+-- .gitignore
+-- README.md
+-- package.json
`-- server.js
```

## Features

- Receives Telegram customer messages through a webhook
- Replies like a friendly clinic receptionist
- Answers opening hours, location, services, pricing disclaimer, emergency instructions, and human handoff requests
- Collects appointment request details:
  - Customer name
  - Preferred date/time
  - Treatment needed
  - Phone number
- Uses simple in-memory conversation memory per Telegram chat
- Supports `/start`, `/reset`, and `/demo`
- Includes a health check route at `GET /`
- Includes a Telegram webhook route at `POST /telegram/webhook`

## 1. Create a Telegram Bot

1. Open Telegram and search for `@BotFather`.
2. Send `/newbot`.
3. Follow the instructions to choose a bot name and username.
4. Copy the bot token from BotFather.

## 2. Set Environment Variables

Create a `.env` file locally by copying `.env.example`:

```bash
cp .env.example .env
```

Then update the values:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
GEMINI_API_KEY=your_gemini_api_key_here
CLINIC_NAME=Smile Dental Clinic
CLINIC_LOCATION=123 Main Street, Kuala Lumpur
CLINIC_HOURS=Monday to Saturday, 9:00 AM to 6:00 PM
CLINIC_PHONE=+6012-345 6789
PORT=3000
```

You can get `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/app/apikey).

Never hardcode real API keys or bot tokens in the code.

## 3. Install and Run Locally

```bash
npm install
npm run dev
```

Open this URL to check the server:

```text
http://localhost:3000
```

You should see:

```text
Telegram AI receptionist demo is running.
```

## 4. Deploy to Render

1. Push this project to GitHub.
2. Log in to [Render](https://render.com).
3. Create a new **Web Service**.
4. Connect your GitHub repository.
5. Use these settings:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
6. Add these environment variables in Render:
   - `TELEGRAM_BOT_TOKEN`
   - `GEMINI_API_KEY`
   - `CLINIC_NAME`
   - `CLINIC_LOCATION`
   - `CLINIC_HOURS`
   - `CLINIC_PHONE`
   - `PORT`
7. Deploy the web service.
8. Copy your Render URL, for example:

```text
https://your-app-name.onrender.com
```

## 5. Set the Telegram Webhook

After deploying, open this URL in your browser. Replace the placeholders first:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<RENDER_URL>/telegram/webhook
```

Example:

```text
https://api.telegram.org/bot123456:ABCDEF/setWebhook?url=https://your-app-name.onrender.com/telegram/webhook
```

Telegram will send new bot messages to:

```text
POST https://your-app-name.onrender.com/telegram/webhook
```

## Bot Commands

- `/start` - Shows the welcome message and menu
- `/reset` - Clears the current chat memory
- `/demo` - Explains that this is a demo AI receptionist

## Notes for Client Demos

- This demo uses server memory only. If the server restarts, chat memory is cleared.
- Appointments are only requests. The bot tells customers that clinic staff will confirm.
- Pricing is handled with a disclaimer because final price depends on dentist assessment.
- Emergency or urgent symptoms are directed to call the clinic immediately or seek emergency care.
- For production use, add a database, staff dashboard, lead notifications, and WhatsApp/WATI integration.
