function requireAuth(req, res, next) {
  if (!req.session || !req.session.dropboxToken) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please connect to Dropbox.',
    });
  }
  next();
}

module.exports = { requireAuth };
