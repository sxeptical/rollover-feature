const crypto = require('crypto');
const logger = require('../utils/logger');

const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY;
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET;
const DROPBOX_REDIRECT_URI = process.env.DROPBOX_REDIRECT_URI || 'http://localhost:3000/auth/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function generateRandomState() {
  return crypto.randomBytes(32).toString('hex');
}

function startOAuth(req, res) {
  if (!DROPBOX_APP_KEY) {
    logger.error('DROPBOX_APP_KEY not configured');
    return res.status(500).json({ success: false, message: 'OAuth not configured' });
  }

  const state = generateRandomState();
  req.session.oauthState = state;

  const authorizeUrl = new URL('https://www.dropbox.com/oauth2/authorize');
  authorizeUrl.searchParams.set('client_id', DROPBOX_APP_KEY);
  authorizeUrl.searchParams.set('redirect_uri', DROPBOX_REDIRECT_URI);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('state', state);

  logger.info('Redirecting to Dropbox OAuth');
  res.redirect(authorizeUrl.toString());
}

async function handleCallback(req, res) {
  const { code, state, error: dropboxError } = req.query;

  if (dropboxError) {
    logger.warn('Dropbox OAuth error', { error: dropboxError });
    return res.redirect(`${FRONTEND_URL}?error=${encodeURIComponent(dropboxError)}`);
  }

  if (!code) {
    logger.warn('OAuth callback missing code');
    return res.redirect(`${FRONTEND_URL}?error=missing_code`);
  }

  const storedState = req.session.oauthState;
  if (!storedState || storedState !== state) {
    logger.warn('OAuth state mismatch', { storedState, receivedState: state });
    return res.redirect(`${FRONTEND_URL}?error=invalid_state`);
  }

  delete req.session.oauthState;

  try {
    const tokenResponse = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: DROPBOX_APP_KEY,
        client_secret: DROPBOX_APP_SECRET,
        redirect_uri: DROPBOX_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      logger.error('Token exchange failed', { error: tokenData });
      return res.redirect(`${FRONTEND_URL}?error=token_exchange_failed`);
    }

    req.session.dropboxToken = tokenData.access_token;
    logger.info('Dropbox OAuth successful');
    res.redirect(FRONTEND_URL);
  } catch (err) {
    logger.error('OAuth callback error', { error: err.message });
    res.redirect(`${FRONTEND_URL}?error=token_exchange_failed`);
  }
}

function logout(req, res) {
  req.session.destroy((err) => {
    if (err) {
      logger.error('Session destroy error', { error: err.message });
      return res.status(500).json({ success: false, message: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true, message: 'Logged out' });
  });
}

function getMe(req, res) {
  res.json({
    authenticated: !!req.session.dropboxToken,
  });
}

module.exports = {
  startOAuth,
  handleCallback,
  logout,
  getMe,
};
