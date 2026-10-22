# XpenseFlow Backend (Render Ready)

A standalone Node.js & Express REST API for **XpenseFlow**, built with Mongoose, JWT authentication, and an automatic **24/7 Keep-Alive Cron Job** for Render free tier.

---

## 🚀 Features

- **Direct MongoDB Atlas Integration**: Connects using Mongoose with full schemas (`User`, `Expense`, `Income`, `Category`, `Budget`, `RecurringExpense`, `SplitGroup`, `TiffinGroup`, `Notification`).
- **Native JWT Authentication**: Registration, login, OTP verification, password reset, and protected routes.
- **Groq LLaMA 3 AI Chatbot**: `/api/chat` endpoint with intent extraction and Agentic expense form actions.
- **⏱️ 24/7 Keep-Alive Cron Job**:
  - Automatically runs every 5 minutes (`*/5 * * * *`) via `node-cron`.
  - Sends an incoming HTTP GET request to `/api/health` using `RENDER_EXTERNAL_URL` (or `SERVER_URL`).
  - **Prevents Render from spinning down due to inactivity** on free tier plans.

---

## 🛠️ Deploying to Render in 3 Steps

### Step 1: Push to GitHub / GitLab
Make sure this `backend/` directory is in your repository.

### Step 2: Create Web Service on Render
1. Go to [dashboard.render.com](https://dashboard.render.com/) and click **New +** -> **Web Service**.
2. Connect your repository.
3. Configure settings:
   - **Root Directory**: `backend` (if in monorepo) or leave blank if deploying as its own repo
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/health`

### Step 3: Add Environment Variables
Add the following in the Render **Environment** tab:
| Key | Value |
|---|---|
| `MONGODB_URI` | `mongodb+srv://...` |
| `JWT_SECRET` | Your secure secret key |
| `GROQ_API_KEY` | Your Groq API key |
| `GROQ_MODEL` | `openai/gpt-oss-120b` or `llama-3.3-70b-versatile` |
| `SMTP_HOST` | `smtp.gmail.com` (optional, for email OTP) |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | Your email |
| `SMTP_PASS` | Your app password |

> **Note on Keep-Alive**: Render automatically sets `RENDER_EXTERNAL_URL` (e.g. `https://xpenseflow-backend.onrender.com`). The built-in cron job uses this URL automatically to send a GET request every 5 minutes.

---

## 🧪 Local Testing

```bash
cd backend
npm install
npm run dev
# or
npm start
```

Health Check:
```bash
curl http://localhost:5000/api/health
```
Output:
```json
{
  "status": "ok",
  "app": "XpenseFlow Dedicated Backend",
  "database": "MongoDB Atlas Connected",
  "uptimeSeconds": 42,
  "renderUrl": "local",
  "time": "2026-10-22T17:25:00.000Z"
}
```
