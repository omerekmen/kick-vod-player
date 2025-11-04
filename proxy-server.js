import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
app.use(cors());

app.get('/api/fetchVod', async (req, res) => {
  const vodUrl = req.query.url;
  if (!vodUrl) return res.status(400).send('Missing URL');

  try {
    const response = await fetch(vodUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });

    const html = await response.text();
    res.set('Access-Control-Allow-Origin', '*');
    res.send(html);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).send('Failed to fetch HTML content');
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});
