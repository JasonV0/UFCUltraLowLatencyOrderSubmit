# ⚡ QUICK START - Get Running in 5 Minutes

## Step 1: Deploy to Render (FREE)

1. Go to https://render.com and sign up
2. Click **"New +"** → **"Web Service"**
3. Choose **"Build and deploy from a Git repository"**
4. Upload these files or connect GitHub
5. Configure:
   - **Name**: `ufc-trader` (or anything you want)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
6. Click **"Create Web Service"**
7. Wait 2-3 minutes for deployment

## Step 2: Access on Your Phone

1. Render will give you a URL like: `https://ufc-trader.onrender.com`
2. Open that URL on your phone
3. Tap the "Share" button
4. Select **"Add to Home Screen"**
5. Now it works like a native app!

## Step 3: Get Your API Keys

1. Install the Polymarket US app and finish identity verification
2. Visit https://polymarket.us/developer and sign in with the **same method**
   (Apple, Google, or email) you used in the app
3. Create a new API key
4. Copy the **Key ID** and the **Secret Key** — the Secret Key is shown only once

## Step 4: Use the App

1. Open the app on your phone
2. Enter your Key ID and Secret Key
3. Enter max bet size (start with $10 for testing)
4. Click "Connect & Load Markets"
5. Select the UFC fight you want to trade
6. Click "Prepare Orders"
7. Keep the app open during the fight
8. When you see a knockout → TAP THE BUTTON!

## That's It! 🎉

Your app is live and ready to use at the next UFC event.

---

## Alternative: Test Locally First

```bash
# In the project folder:
npm install
npm start

# Open browser to: http://localhost:3000
```

Then deploy when you're ready.
