const express = require('express');
const { health } = require('../controllers/demoController');
const aimlRoutes = require('./aiml.routes');

const router = express.Router();

router.get('/health', health);
router.use('/aiml', aimlRoutes);

module.exports = router;
