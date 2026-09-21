# UFC Arbitrage Trader - Deployment Guide

##  Quick Start

This app lets you execute ultra-fast trades on Polymarket UFC markets when you're at the event.

##  How to Use on Your Phone

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
   - Auto fills at best price

## Speed Optimization Tips

1. **Connection**: Use 5G UWB
2. **Battery**: Disable low power mode


## Troubleshooting

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


## Advanced (If You Want to Modify)

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

## Legal Disclaimer

This tool is for educational purposes. Make sure you:
- Understand the risks of prediction markets
- Only bet what you can afford to lose
- Comply with all local laws and regulations
- Are not in a restricted jurisdiction

## To Deploy: 

**Fastest Path:**
1. Create Render account
2. Upload these files
3. Deploy
4. Access URL on phone
5. Add to home screen
6. You're ready!

Good luck! 🍀
