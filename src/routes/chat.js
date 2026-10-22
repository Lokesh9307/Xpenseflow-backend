const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Expense = require('../models/Expense');
const Category = require('../models/Category');

// POST /api/chat
router.post('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { message, mode, history } = req.body;

    if (!message) return res.status(400).json({ message: 'Message is required' });

    // Local parser for agentic intent
    const amountMatch = message.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:rs|k)?/i);
    let amount = null;
    if (amountMatch) {
      amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    }

    let paymentMethod = 'UPI';
    if (/cash/i.test(message)) paymentMethod = 'Cash';
    else if (/credit/i.test(message)) paymentMethod = 'Credit Card';
    else if (/debit/i.test(message)) paymentMethod = 'Debit Card';

    let category = 'Others';
    if (/grocer|food|eat|dinner|lunch|pizza|burger|snack/i.test(message)) category = 'Food & Dining';
    else if (/shop|cloth|amazon|flipkart|zara/i.test(message)) category = 'Shopping';
    else if (/travel|uber|ola|cab|auto|flight|petrol/i.test(message)) category = 'Travel & Commute';
    else if (/bill|wifi|electricity|rent/i.test(message)) category = 'Bills & Utilities';

    const apiKey = process.env.GROQ_API_KEY;

    let botResponse = '';
    let parsedExpense = null;

    if (amount && /add|spend|spent|paid|log/i.test(message)) {
      botResponse = `I've prepared an expense of ₹${amount} for "${category}" via ${paymentMethod}. Tap below to confirm and save it:`;
      parsedExpense = {
        amount,
        category,
        paymentMethod,
        date: new Date().toISOString(),
      };
    } else if (apiKey) {
      try {
        // Fetch recent context for financial answering
        const recentExpenses = await Expense.find({ userId }).sort({ date: -1 }).limit(10);
        const contextSummary = recentExpenses
          .map((e) => `• ${e.title}: ₹${e.amount} (${e.category})`)
          .join('\n');

        const systemPrompt = `You are ExpenseBot, a friendly and accurate AI financial assistant for XpenseFlow.
User's recent expenses:
${contextSummary || 'No recent expenses recorded yet.'}
Keep your answers brief, clear, and actionable. Use ₹ for currency.`;

        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: systemPrompt },
              ...(history || []).slice(-4),
              { role: 'user', content: message },
            ],
            temperature: 0.5,
            max_tokens: 300,
          }),
        });

        const groqData = await groqRes.json();
        botResponse =
          groqData.choices?.[0]?.message?.content ||
          "Here's what I found from your finances.";
      } catch (llmErr) {
        console.error('Groq LLM call error:', llmErr);
        botResponse = "I've reviewed your request. You can track spending, check category budgets, or add payments directly.";
      }
    } else {
      botResponse = "I've reviewed your request. You can track spending, check category budgets, or add payments directly.";
    }

    return res.json({
      response: botResponse,
      form: parsedExpense,
    });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
