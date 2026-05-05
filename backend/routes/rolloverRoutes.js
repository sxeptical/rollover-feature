const express = require('express');
const router = express.Router();
const rolloverController = require('../controllers/rolloverController');
const { requireAuth } = require('../middleware/auth');

router.post('/rollover', requireAuth, rolloverController.createRollover);
router.get('/status/:jobId', requireAuth, rolloverController.getStatus);

module.exports = router;
