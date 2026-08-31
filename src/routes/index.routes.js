const express = require('express');
const { health } = require('../controllers/demoController');

const router = express.Router();

router.get('/health', health);

module.exports = router;
