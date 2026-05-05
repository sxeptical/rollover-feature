const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/dropbox', authController.startOAuth);
router.get('/callback', authController.handleCallback);
router.post('/logout', authController.logout);
router.get('/me', authController.getMe);

module.exports = router;
