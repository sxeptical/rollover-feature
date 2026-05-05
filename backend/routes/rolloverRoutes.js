const express = require('express');
const router = express.Router();
const rolloverController = require('../controllers/rolloverController');

router.post('/rollover', rolloverController.requireAuth, rolloverController.createRollover);
router.get('/status/:jobId', rolloverController.getStatus);

module.exports = router;
