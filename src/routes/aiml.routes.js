/* ==========================================================================
   aiml.routes.js — AI/ML Engine REST API Routes
   SIH26052 Tactical ANC Headset Console
   ========================================================================== */

const express = require('express');
const { classify, enhance, benchmark, hardwareProfile } = require('../controllers/aimlController');

const router = express.Router();

// GET /api/aiml/classify?scenario=heli|tank|gun|voice|siren
// Returns 5-class scene classification probabilities from Brain 1
router.get('/classify', classify);

// GET /api/aiml/enhance?scenario=voice&mode=1
// Returns Brain 2 step-size prediction + Brain 3 mask parameters
router.get('/enhance', enhance);

// GET /api/aiml/benchmark
// Returns pre-computed comparative benchmark (Systems A/B/C/D)
router.get('/benchmark', benchmark);

// GET /api/aiml/hardware-profile
// Returns ARM Cortex-M55 + Ethos-U55 resource budget
router.get('/hardware-profile', hardwareProfile);

module.exports = router;
