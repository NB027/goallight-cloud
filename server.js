// ============================================================
// GOAL LIGHT CLOUD SERVER
// ============================================================
// Stack: Node.js + Express + apns2
//
// Deploy to Railway, Render, Fly.io, etc.
//
// Setup:
//   1) npm install express apns2
//   2) Download your APNs .p8 key file from Apple Developer
//      → Place it in this folder as "AuthKey_XXXXXXXXXX.p8"
//   3) Set the constants below (TEAM_ID, KEY_ID, KEY_PATH, BUNDLE_ID)
//   4) Run: node server.js
// ============================================================

const express  = require("express");
const { Apns, Device, Notification } = require("apns2");
const fs       = require("fs");
const path     = require("path");

const app  = express();
app.use(express.json());

// ============================================================
// CONFIG — fill these in
// ============================================================

const TEAM_ID   = "YOUR_TEAM_ID";                           // 10-char Apple Team ID
const KEY_ID    = "YOUR_KEY_ID";                            // Key ID from .p8 download
const KEY_PATH  = path.join(__dirname, "AuthKey_XXXXXXXXXX.p8"); // path to your .p8 file
const BUNDLE_ID = "com.yourname.GoalLightApp";              // your app's bundle ID
const PORT      = process.env.PORT || 3000;

// ============================================================
// APNs client setup
// ============================================================

const apnsClient = new Apns({
    key:  fs.readFileSync(KEY_PATH),
    keyId: KEY_ID,
    teamId: TEAM_ID,
    production: false  // set to true when using production App Store builds
});

// ============================================================
// In-memory state
// (For production you'd use a DB, but this is fine for personal use)
// ============================================================

let registeredDeviceToken = null;   // iPhone's APNs token
let espStatus = {                   // last known ESP state
    phase: "unknown",
    message: "",
    awake: false                    // whether ESP is currently awake
};
let commandQueue = [];              // commands queued while ESP is asleep

// ============================================================
// ROUTES
// ============================================================

// --- iPhone registers its APNs device token ---
app.post("/register", (req, res) => {
    const { deviceToken } = req.body;
    if (!deviceToken) return res.status(400).json({ error: "Missing deviceToken" });

    registeredDeviceToken = deviceToken;
    console.log("📱 iPhone registered. Token:", deviceToken.slice(0, 16) + "...");
    res.json({ status: "registered" });
});

// --- ESP8266 reports its current status (called on each wake) ---
app.post("/esp/status", (req, res) => {
    const { phase, message } = req.body;

    espStatus.phase   = phase || "unknown";
    espStatus.message = message || "";
    espStatus.awake   = true;

    console.log("🔌 ESP status:", espStatus.phase, "-", espStatus.message);

    // Push silent notification to iPhone so it updates in background
    if (registeredDeviceToken) {
        pushToPhone({
            phase:   espStatus.phase,
            message: espStatus.message,
            silent:  true
        });
    }

    res.json({ status: "ok", queued: commandQueue.length });
});

// --- ESP8266 checks for queued commands (called on each wake) ---
app.get("/esp/poll", (req, res) => {
    espStatus.awake = true;

    if (commandQueue.length > 0) {
        const command = commandQueue.shift(); // grab first queued command
        console.log("📤 Delivering queued command to ESP:", command);
        res.json({ command });
    } else {
        res.json({ command: null });
    }
});

// --- ESP8266 tells us it's going back to sleep ---
app.post("/esp/sleep", (req, res) => {
    espStatus.awake = false;
    console.log("😴 ESP going to sleep. Next wake:", req.body.nextWake || "unknown");
    res.json({ status: "ok" });
});

// --- iPhone sends activate command ---
app.post("/activate", (req, res) => {
    const { command } = req.body; // "Test"

    if (espStatus.awake) {
        // ESP is awake — we can't directly forward to ESP from here easily,
        // so we queue it and it'll pick it up on next /esp/poll (which happens
        // frequently while awake, or you can have ESP poll immediately after status).
        // For a truly instant send, you could keep a WebSocket open to ESP,
        // but for goal-light use case the poll approach is fine.
        commandQueue.push(command || "Test");
        console.log("✅ ESP is awake. Command queued for immediate poll pickup.");
        res.json({ status: "sent" });
    } else {
        // ESP is asleep — queue it for next wake
        commandQueue.push(command || "Test");
        console.log("⏳ ESP is asleep. Command queued. Queue length:", commandQueue.length);
        res.json({ status: "queued" });
    }
});

// ============================================================
// HELPER: Push notification to iPhone
// ============================================================

async function pushToPhone(payload) {
    if (!registeredDeviceToken) {
        console.warn("⚠️  No device token registered yet.");
        return;
    }

    const notification = new Notification({
        // Silent notification (no banner/sound) — just updates state
        // iOS requires content-available: 1 for silent push
        body: payload.silent ? undefined : payload.message,
        title: payload.silent ? undefined : "Goal Light",
        sound: payload.silent ? undefined : "default",
        userInfo: payload,
        // This tells iOS to wake the app in the background
        contentAvailable: true
    });

    try {
        const result = await apnsClient.send(registeredDeviceToken, notification);
        console.log("📨 Push sent:", result.status);
    } catch (err) {
        console.error("❌ Push failed:", err.message);
    }
}

// ============================================================
// START
// ============================================================

app.listen(PORT, () => {
    console.log(`🚀 Goal Light Cloud Server running on port ${PORT}`);
});
