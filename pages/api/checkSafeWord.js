export default function handler(req, res) {
  if (req.method === 'POST') {
    res.status(200).json({ matched: false });
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
}
