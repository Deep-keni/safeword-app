const SIMILARITY_THRESHOLD = 0.85;

// Helper to fetch embeddings from the Google Gemini API (gemini-embedding-001)
async function getEmbedding(text, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
  console.log(`Calling Gemini Embedding API URL: ${url}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: {
        parts: [{ text: text }],
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`FAILED API URL: ${url}`);
    console.error(`Gemini API Error Response Code: ${response.status}`);
    console.error(`Gemini API Error Response Body: ${errText}`);
    throw new Error(`Gemini API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  if (!data.embedding || !data.embedding.values) {
    throw new Error('Invalid embedding response format from Gemini API');
  }

  return data.embedding.values;
}

// Helper to compute Cosine Similarity between two vectors
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must be of the same length');
  }
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { transcript, codePhrase } = req.body;
  if (!transcript || !codePhrase) {
    return res.status(400).json({ error: 'Missing transcript or codePhrase' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Missing GEMINI_API_KEY environment variable.');
    return res.status(500).json({ error: 'Server configuration error: missing API key' });
  }

  try {
    const [transcriptEmbedding, codePhraseEmbedding] = await Promise.all([
      getEmbedding(transcript, apiKey),
      getEmbedding(codePhrase, apiKey)
    ]);

    const score = cosineSimilarity(transcriptEmbedding, codePhraseEmbedding);
    const matched = score > SIMILARITY_THRESHOLD;

    return res.status(200).json({ matched, score });
  } catch (error) {
    console.error('Semantic matching error:', error.message || error);
    return res.status(200).json({ matched: false, error: true });
  }
}
