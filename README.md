# UFC Arbitrage Trader - Deployment Guide

## 🚀 Quick Start

This app lets you execute ultra-fast trades on Polymarket UFC markets when you're at the event.

## 📱 How to Use on Your Phone

### Option 1: Deploy to Render (FREE & FASTEST - RECOMMENDED)

1. **Create Render Account**
   - Go to https://render.com
   - Sign up (free tier available)

2. **Deploy**
   - Click "New +" → "Web Service"
   - Connect your GitHub (or upload these files)
   - Settings:
     - **Name**: ufc-trader
     - **Environment**: Node
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`
   - Click "Create Web Service"

3. **Access on Phone**
   - Your app will be at: `https://ufc-trader.onrender.com`
   - Open Safari/Chrome on your phone
   - Tap "Add to Home Screen" for app-like experience
   - **DONE!**

### Option 2: Deploy to Vercel (Alternative)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Follow prompts, then access at the URL provided
```

### Option 3: Run Locally (For Testing)

```bash
# Install dependencies
npm install

# Start server
npm start

# Server runs at http://localhost:3000
```

**To access from phone on same WiFi:**
1. Find your computer's IP address:
   - Mac: System Preferences → Network
   - Windows: ipconfig
2. On phone, visit: `http://YOUR_IP:3000`

## 🔑 Getting Your Polymarket US API Keys

This app trades on **Polymarket US** (`polymarket.us`), the CFTC-regulated exchange.
It uses Ed25519 API keys, not a wallet private key.

1. Install the Polymarket US app and create an account
2. Complete identity verification (required before API access)
3. Go to https://polymarket.us/developer and sign in **with the same method** you
   used in the app (Apple, Google, or email) — switching methods breaks key access
4. Click to create a new API key
5. Copy both the **Key ID** (a UUID) and the **Secret Key** (base64)

⚠️ The Secret Key is shown only once and cannot be recovered. Never share it.

## 📖 Usage Instructions

### Before the Event:

1. **Fund Your Account**
   - Deposit into your Polymarket US account
   - Make sure you have enough for your max bet size

2. **Test the App**
   - Open the app on your phone
   - Enter your Key ID and Secret Key
   - Enter max bet size (start small for testing!)
   - Click "Connect & Load Markets"

3. **Select the Fight**
   - You'll see a list of upcoming UFC fights
   - Tap the fight you want to trade
   - Click "Prepare Orders"

### At the Event:

1. **Keep App Open**
   - Keep the trading screen open in your browser
   - Don't let phone screen lock
   - Stay in foreground

2. **When Knockout Happens**
   - **See the knockout**
   - **Instantly tap the appropriate button:**
     - BUY [Winner's Name] ← Tap this
   - Order submits immediately

3. **Confirmation**
   - You'll see "Order placed!" with order ID
   - Order goes through 3-second matching delay (everyone has this)
   - Fills at best available price

## ⚡ Speed Optimization Tips

1. **Connection**: Use 5G UWB at Prudential Center (you confirmed it has this)
2. **Battery**: Disable low power mode
3. **Screen**: Keep brightness up so you don't need to unlock
4. **Position**: Keep thumb ready on button
5. **Testing**: Test with small amounts first!

## 🎯 Strategy Execution

**Your Timeline:**
- T+0.0s: Knockout happens (you see it live)
- T+0.2s: You tap button
- T+0.3s: Pre-signed order submits
- T+3.3s: Matching completes (3-second delay for all)

**Their Timeline (streaming viewers):**
- T+0.0s: Knockout happens
- T+5-10s: They see it (broadcast delay)
- T+5.3s+: They submit order
- T+8.3s+: Matching completes

**You have ~5-7 second edge**

## 🔧 Troubleshooting

**"Session not found"**
- Reconnect by entering your API keys again

**Auth errors on connect**
- Your `X-PM-Timestamp` must be within 30 seconds of server time — check the
  machine's clock is synced
- Confirm you signed in to the developer portal with the same method as the app

**"No UFC markets found"**
- The app only lists open `ufc_fight_winner` markets starting within 7 days
- Try again closer to event time

**"Order failed"**
- Check you have enough USDC balance
- Make sure you're not in a restricted region
- Try reducing bet size

**App not loading**
- Check internet connection
- Try refreshing page
- Clear browser cache

## 📂 Project Structure

```
ufc-arbitrage-app/
├── server.js          # Backend API
├── public/
│   └── index.html     # Frontend app
├── package.json       # Dependencies
└── README.md          # This file
```

## 🔒 Security Notes

1. **Secret Key**: Never commit to GitHub, never share. Revoke compromised keys at
   https://polymarket.us/developer
2. **HTTPS**: Always use HTTPS in production (Render/Vercel do this automatically)
3. **Test First**: Start with small amounts
4. **Session Management**: The Secret Key is only stored in memory during the session

## 💡 Pro Tips

1. **Pre-Event Testing**:
   - Test the entire flow before the event
   - Make sure you can connect and select markets
   - Test with a small bet first

2. **At the Arena**:
   - Arrive early to set up
   - Test your 5G connection in your seat
   - Have the app loaded and ready before fights start
   - Keep phone charged (bring portable charger)

3. **Execution**:
   - React instantly when you see the knockout
   - Don't second-guess - tap immediately
   - The 3-second matching delay gives you time

## 📊 Understanding the 3-Second Delay

Polymarket has a 3-second delay on all "marketable orders" (market orders) before they match. This means:

- **Everyone experiences this delay** (you + remote traders)
- Your edge is seeing the knockout 5-7 seconds before streaming viewers
- Even with the delay, you're still way ahead

## 🎓 Advanced: If You Want to Modify

The frontend (`public/index.html`) and backend (`server.js`) are separate:

- **Frontend**: Handles UI, user input
- **Backend**: Handles Polymarket API, order signing, submission

To modify bet logic, edit `server.js` in the `/api/order` endpoint.

## 📞 Support

If you run into issues:
1. Check the browser console for errors (F12)
2. Check the server logs
3. Make sure your Key ID and Secret Key are correct
4. Verify you have funds in your Polymarket US account

## ⚠️ Legal Disclaimer

This tool is for educational purposes. Make sure you:
- Understand the risks of prediction markets
- Only bet what you can afford to lose
- Comply with all local laws and regulations
- Are not in a restricted jurisdiction

## 🚀 Ready to Deploy?

**Fastest Path:**
1. Create Render account
2. Upload these files
3. Deploy
4. Access URL on phone
5. Add to home screen
6. You're ready!

Good luck! 🍀
