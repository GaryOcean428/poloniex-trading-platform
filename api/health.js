export default function handler(req, res) {
  res.status(200).json({ status: 'up', timestamp: new Date().toISOString() });
}
