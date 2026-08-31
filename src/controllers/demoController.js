function health(req, res) {
  res.json({ status: 'ok', service: 'sih26052-anc-sim' });
}

module.exports = { health };
