const express = require('express');
const { health } = require('../controllers/demoController');
const aimlRoutes = require('./aiml.routes');
const mlRoutes = require('./ml.routes');

const router = express.Router();

router.get('/health', health);
router.use('/aiml', aimlRoutes);
router.use('/ml', mlRoutes);

module.exports = router;
