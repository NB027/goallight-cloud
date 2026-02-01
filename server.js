// ============================================================
// GOAL LIGHT CLOUD SERVER (No APNs — polling only)
// ============================================================
// Stack: Node.js + Express
//
// Deploy to Render (free tier) or any Node host.
//
// Setup:
//   1) npm install
//   2) npm start
//   3) Deploy to Render — grab the URL
//   4) Paste that URL into GoalLightManager.swift (cloudBaseURL)
//      and GoalLight.ino (CLOUD_URL)
// ============================================================

const express = require("express");
const app     = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ============================================================
// In-memory state
// (Fine for personal use — restarts clear it, but ESP will
//  re-report its status on next wake anyway)
// ============================================================

let espStatus = {
    phase:   "unknown",
    message: "",
    awake:   false
};

let commandQueue = []; // commands waiting for ESP to pick up

// ============================================================
// ROUTES
// ============================================================

// --- iPhone polls this to get current ESP status ---
app.get("/status", (req, res) => {
    res.json({
        phase:   espStatus.phase,
        message: espStatus.message,
        awake:   espStatus.awake
    });
});

// --- ESP8266 reports its status on each wake ---
app.post("/esp/status", (req, res) => {
    const { phase, message } = req.body;

    espStatus.phase   = phase || "unknown";
    espStatus.message = message || "";
    espStatus.awake   = true;

    console.log("🔌 ESP status:", espStatus.phase, "-", espStatus.message);

    res.json({ status: "ok", queued: commandQueue.length });
});

// --- ESP8266 polls for queued commands on each wake ---
app.get("/esp/poll", (req, res) => {
    espStatus.awake = true;

    if (commandQueue.length > 0) {
        const command = commandQueue.shift();
        console.log("📤 Delivering queued command to ESP:", command);
        res.json({ command });
    } else {
        res.json({ command: null });
    }
});

// --- ESP8266 tells us it's going to sleep ---
app.post("/esp/sleep", (req, res) => {
    espStatus.awake = false;
    console.log("😴 ESP going to sleep. Next wake:", req.body.nextWake || "unknown");
    res.json({ status: "ok" });
});

// --- iPhone sends activate command ---
app.post("/activate", (req, res) => {
    const { command } = req.body;

    commandQueue.push(command || "Test");

    if (espStatus.awake) {
        console.log("✅ ESP is awake. Command queued for next poll.");
        res.json({ status: "sent" });
    } else {
        console.log("⏳ ESP is asleep. Command queued. Queue length:", commandQueue.length);
        res.json({ status: "queued" });
    }
});

// ============================================================
// START
// ============================================================

app.listen(PORT, () => {
    console.log(`🚀 Goal Light Cloud Server running on port ${PORT}`);
});
