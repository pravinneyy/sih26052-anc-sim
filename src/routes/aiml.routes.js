/* ==========================================================================
   aiml.routes.js — Backend REST Routes for AI/ML Model & Telemetry
   ========================================================================== */

const express = require('express');
const { getModelInfo, getHardwareProfile, classifyAudioSummary } = require('../controllers/aimlController');

const router = express.Router();

router.get('/info', getModelInfo);
router.get('/hardware-profile', getHardwareProfile);
router.get('/benchmark', classifyAudioSummary);

module.exports = router;
