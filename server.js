const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3501;

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const users = new Map();
const communityPosts = [];

function getUser(userId) {
  if (!users.has(userId)) {
    users.set(userId, {
      id: userId,
      isPro: false,
      streak: 0,
      totalPoints: 0,
      lastCheckIn: null,
      mood: [],
      gratitude: [],
      tasks: []
    });
  }
  return users.get(userId);
}

app.post('/api/daily-briefing', async (req, res) => {
  const { userId, name, mood } = req.body;
  
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a warm, encouraging wellness coach. Give a brief, uplifting morning briefing (3-4 sentences) that includes: 1) A personalized greeting, 2) An affirmation based on their mood, 3) A simple wellness tip for the day. Be concise but heartfelt.'
        },
        {
          role: 'user',
          content: `Good morning! My name is ${name || 'friend'}. I'm feeling ${mood || 'okay'} today.`
        }
      ]
    });
    
    res.json({
      briefing: completion.choices[0].message.content,
      date: new Date().toISOString()
    });
  } catch (error) {
    console.error('AI Error:', error);
    res.json({
      briefing: `Good morning${name ? ', ' + name : ''}! Today is full of possibilities. Remember: small steps lead to big changes. Take a moment to breathe deeply and set one positive intention for today. You've got this!`,
      date: new Date().toISOString()
    });
  }
});

app.post('/api/mood-checkin', (req, res) => {
  const { userId, mood, note } = req.body;
  const user = getUser(userId);
  
  const today = new Date().toDateString();
  const lastDate = user.lastCheckIn ? new Date(user.lastCheckIn).toDateString() : null;
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  
  if (lastDate === yesterday) {
    user.streak++;
  } else if (lastDate !== today) {
    user.streak = 1;
  }
  
  user.lastCheckIn = new Date().toISOString();
  user.mood.push({ mood, note, date: user.lastCheckIn });
  user.totalPoints += 10;
  
  res.json({
    streak: user.streak,
    points: user.totalPoints,
    message: `+10 points! ${user.streak} day streak!`
  });
});

app.post('/api/gratitude', (req, res) => {
  const { userId, items } = req.body;
  const user = getUser(userId);
  
  user.gratitude.push({
    items,
    date: new Date().toISOString()
  });
  user.totalPoints += 15;
  
  res.json({
    points: user.totalPoints,
    message: '+15 points for practicing gratitude!'
  });
});

app.get('/api/daily-tasks', (req, res) => {
  const tasks = [
    { id: 1, title: 'Morning stretch (5 min)', points: 10, icon: '🧘' },
    { id: 2, title: 'Drink 8 glasses of water', points: 10, icon: '💧' },
    { id: 3, title: '10-minute walk outside', points: 15, icon: '🚶' },
    { id: 4, title: 'No phone for 1 hour', points: 20, icon: '📵' },
    { id: 5, title: 'Read for 15 minutes', points: 15, icon: '📚' },
    { id: 6, title: 'Mindful breathing (3 min)', points: 10, icon: '🌬️' }
  ];
  res.json({ tasks });
});

app.post('/api/complete-task', (req, res) => {
  const { userId, taskId, points } = req.body;
  const user = getUser(userId);
  
  user.totalPoints += points;
  user.tasks.push({ taskId, completedAt: new Date().toISOString() });
  
  res.json({
    points: user.totalPoints,
    message: `+${points} points! Keep going!`
  });
});

app.get('/api/community', (req, res) => {
  const recentPosts = communityPosts.slice(-20).reverse();
  res.json({ posts: recentPosts });
});

app.post('/api/community', (req, res) => {
  const { userId, userName, message, type } = req.body;
  const user = getUser(userId);
  
  if (!user.isPro) {
    return res.status(403).json({ error: 'Community posting is a Pro feature!' });
  }
  
  const post = {
    id: Date.now(),
    userId,
    userName: userName || 'Anonymous',
    message,
    type: type || 'share',
    likes: 0,
    createdAt: new Date().toISOString()
  };
  
  communityPosts.push(post);
  user.totalPoints += 5;
  
  res.json({ post, points: user.totalPoints });
});

app.get('/api/stats/:userId', (req, res) => {
  const user = getUser(req.params.userId);
  res.json({
    streak: user.streak,
    points: user.totalPoints,
    isPro: user.isPro,
    moodHistory: user.mood.slice(-7),
    recentGratitude: user.gratitude.slice(-3)
  });
});

app.post('/api/create-subscription', async (req, res) => {
  const { userId, origin } = req.body;
  
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'GoodVibe Pro',
            description: 'Monthly wellness subscription - AI coaching, community, advanced features',
          },
          unit_amount: 299,
          recurring: { interval: 'month' }
        },
        quantity: 1,
      }],
      success_url: `${origin}?success=true&user_id=${userId}`,
      cancel_url: `${origin}?canceled=true`,
      metadata: { userId }
    });
    
    res.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

app.post('/api/activate-pro', (req, res) => {
  const { userId } = req.body;
  const user = getUser(userId);
  user.isPro = true;
  res.json({ success: true, isPro: true });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', app: 'GoodVibe', version: '1.0.0' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GoodVibe running on port ${PORT}`);
});
