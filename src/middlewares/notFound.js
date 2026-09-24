function notFound(req, res) {
  res.status(404).json({ error: 'not found', path: req.url });
}

module.exports = notFound;
