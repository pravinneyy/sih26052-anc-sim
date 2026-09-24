const express = require('express');
const { batchEnhance } = require('../controllers/mlController');

const router = express.Router();

router.post('/batch-enhance', batchEnhance);

module.exports = router;
