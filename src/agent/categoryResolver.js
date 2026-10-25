/**
 * Deterministic Category Resolver
 * 
 * Maps natural language phrases and extracted entities to the authenticated
 * user's real category documents stored in MongoDB.
 * 
 * Non-negotiable rules implemented:
 * 1. Must use real category IDs belonging to the authenticated user.
 * 2. Never create a category automatically merely because an unknown name was provided.
 * 3. Never silently substitute an unrelated category.
 * 4. Resolves expressions like "petrol" or "fuel" to "Travel & Commute", NEVER to "Food & Dining".
 * 5. Flags ambiguous matches and requests clarification.
 */

const Category = require('../models/Category');

// Curated canonical archetype aliases
const ARCHETYPE_ALIASES = {
  'Travel & Commute': [
    'travel', 'commute', 'petrol', 'fuel', 'diesel', 'cng', 'gas station',
    'shell', 'hp petrol', 'indian oil', 'bharat petroleum', 'fuel pump',
    'uber', 'ola', 'rapido', 'cab', 'taxi', 'auto', 'rickshaw', 'autorickshaw',
    'metro', 'bus', 'train', 'local train', 'irctc', 'railway', 'ticket',
    'flight', 'airline', 'indigo', 'air india', 'spicejet', 'vistara',
    'toll', 'fastag', 'parking', 'car repair', 'bike service', 'scooter'
  ],
  'Food & Dining': [
    'food', 'dining', 'eat', 'dinner', 'lunch', 'breakfast', 'brunch', 'snack',
    'snacks', 'tea', 'chai', 'coffee', 'cafe', 'starbucks', 'ccd', 'restaurant',
    'swiggy', 'zomato', 'pizza', 'dominos', 'burger', 'mcdonalds', 'kfc',
    'biryani', 'mess', 'hotel food', 'takeout', 'bakery', 'dessert', 'ice cream'
  ],
  'Shopping': [
    'shopping', 'clothes', 'clothing', 'apparel', 'shirt', 'pants', 'tshirt',
    'shoes', 'sneakers', 'sandals', 'zara', 'h&m', 'myntra', 'ajio', 'amazon',
    'flipkart', 'meesho', 'electronics', 'gadgets', 'laptop', 'mobile phone',
    'watch', 'accessories', 'mall', 'superstore', 'retail'
  ],
  'Bills & Utilities': [
    'bills', 'utilities', 'utility', 'electricity', 'current bill', 'power',
    'bescom', 'water bill', 'gas bill', 'lpg', 'cylinder', 'indane', 'hp gas',
    'wifi', 'broadband', 'internet', 'fiber', 'airtel', 'jio', 'vi', 'vodafone',
    'mobile recharge', 'phone recharge', 'dth', 'tata play', 'dish tv',
    'rent', 'house rent', 'flat rent', 'maintenance', 'society'
  ],
  'Entertainment': [
    'entertainment', 'movie', 'movies', 'cinema', 'theatre', 'theater', 'pvr',
    'inox', 'cinepolis', 'film', 'netflix', 'amazon prime', 'prime video',
    'disney', 'hotstar', 'spotify', 'apple music', 'youtube premium', 'gaming',
    'steam', 'playstation', 'concert', 'amusement park'
  ],
  'Groceries': [
    'groceries', 'grocery', 'supermarket', 'veggies', 'vegetables', 'fruits',
    'sabzi', 'kirana', 'ration', 'milk', 'bread', 'eggs', 'flour', 'atta', 'rice',
    'bigbasket', 'blinkit', 'zepto', 'instamart', 'dmart', 'reliance fresh'
  ],
  'Health & Medical': [
    'health', 'medical', 'medicine', 'medicines', 'pharmacy', 'chemist',
    'apollo', '1mg', 'pharmeasy', 'netmeds', 'doctor', 'consultation',
    'clinic', 'hospital', 'lab test', 'blood test', 'dentist', 'gym', 'fitness'
  ],
  'Others': [
    'others', 'other', 'misc', 'miscellaneous', 'general', 'cash', 'transfer'
  ]
};

/**
 * Normalizes an input string for comparison.
 */
function normalizeString(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/[^\w\s&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves a natural-language category phrase to an actual User Category document.
 * 
 * @param {string} inputPhrase - The phrase extracted from user message (e.g. "petrol", "food", "Groceries")
 * @param {string} fullMessage - The original complete user prompt for context
 * @param {Array<Object>} userCategories - Actual category documents owned by the user from MongoDB
 * @returns {{
 *   resolved: boolean,
 *   categoryId?: string,
 *   categoryName?: string,
 *   isAmbiguous?: boolean,
 *   confidence: number,
 *   candidates?: Array<string>,
 *   reason?: string
 * }}
 */
function resolveCategoryFromList(inputPhrase, fullMessage, userCategories) {
  if (!Array.isArray(userCategories) || userCategories.length === 0) {
    return {
      resolved: false,
      confidence: 0,
      candidates: [],
      reason: 'User has no categories configured.',
    };
  }

  const cleanPhrase = normalizeString(inputPhrase);
  const cleanFullMsg = normalizeString(fullMessage);

  // 1. Direct Exact Match on category name
  for (const cat of userCategories) {
    const normCatName = normalizeString(cat.name);
    if (normCatName === cleanPhrase) {
      return {
        resolved: true,
        categoryId: String(cat._id || cat.id),
        categoryName: cat.name,
        confidence: 1.0,
      };
    }
  }

  // 2. Archetype / Alias Match
  // Check which archetype the input matches
  const matchedArchetypes = [];

  for (const [archetypeName, aliases] of Object.entries(ARCHETYPE_ALIASES)) {
    // Check if cleanPhrase is in aliases
    const inAliases = aliases.some((a) => {
      const normA = normalizeString(a);
      return normA === cleanPhrase || (cleanPhrase.length > 3 && cleanPhrase.split(' ').includes(normA));
    });

    // Check if phrase or full message contains explicit archetype keywords as discrete words
    const discreteInMsg = aliases.some((a) => {
      const normA = normalizeString(a);
      const regex = new RegExp(`\\b${normA.replace(/\s+/g, '\\s+')}\\b`, 'i');
      return (cleanPhrase && regex.test(cleanPhrase)) || (cleanFullMsg && regex.test(cleanFullMsg));
    });

    if (inAliases || discreteInMsg) {
      matchedArchetypes.push(archetypeName);
    }
  }

  // If multiple distinct archetypes matched (e.g. "petrol and grocery"), flag ambiguity
  if (matchedArchetypes.length > 1) {
    // Check if one is a subset or if user phrase specifically matches one
    const exactPhraseMatches = matchedArchetypes.filter((arch) =>
      ARCHETYPE_ALIASES[arch].some((a) => normalizeString(a) === cleanPhrase)
    );
    if (exactPhraseMatches.length === 1) {
      matchedArchetypes.length = 0;
      matchedArchetypes.push(exactPhraseMatches[0]);
    }
  }

  if (matchedArchetypes.length === 1) {
    const targetArchetype = matchedArchetypes[0];

    // Find the user's category that corresponds to this archetype
    // 2a. Direct name match with targetArchetype
    const directCat = userCategories.find(
      (c) => normalizeString(c.name) === normalizeString(targetArchetype)
    );
    if (directCat) {
      return {
        resolved: true,
        categoryId: String(directCat._id || directCat.id),
        categoryName: directCat.name,
        confidence: 0.95,
      };
    }

    // 2b. If target is 'Groceries' but user only has 'Food & Dining', allow mapping ONLY if user doesn't have Groceries
    if (targetArchetype === 'Groceries') {
      const foodCat = userCategories.find(
        (c) => normalizeString(c.name) === normalizeString('Food & Dining')
      );
      if (foodCat) {
        return {
          resolved: true,
          categoryId: String(foodCat._id || foodCat.id),
          categoryName: foodCat.name,
          confidence: 0.85,
        };
      }
    }

    // 2c. Check if user has a custom category whose name matches any alias of this archetype
    for (const cat of userCategories) {
      const normCatName = normalizeString(cat.name);
      if (ARCHETYPE_ALIASES[targetArchetype].includes(normCatName)) {
        return {
          resolved: true,
          categoryId: String(cat._id || cat.id),
          categoryName: cat.name,
          confidence: 0.9,
        };
      }
    }
  }

  // 3. Check if user category names exist as substring/word in input phrase
  const candidateMatches = [];
  for (const cat of userCategories) {
    const normCatName = normalizeString(cat.name);
    if (cleanPhrase && (cleanPhrase.includes(normCatName) || normCatName.includes(cleanPhrase))) {
      candidateMatches.push(cat);
    }
  }

  if (candidateMatches.length === 1) {
    return {
      resolved: true,
      categoryId: String(candidateMatches[0]._id || candidateMatches[0].id),
      categoryName: candidateMatches[0].name,
      confidence: 0.8,
    };
  }

  if (candidateMatches.length > 1 || matchedArchetypes.length > 1) {
    const candidateNames = Array.from(
      new Set([
        ...candidateMatches.map((c) => c.name),
        ...matchedArchetypes,
      ])
    );
    return {
      resolved: false,
      isAmbiguous: true,
      confidence: 0.4,
      candidates: candidateNames,
      reason: `The phrase "${inputPhrase || 'expense'}" is ambiguous between multiple categories.`,
    };
  }

  // 4. Default: Category could not be resolved reliably
  // NEVER silently default to Food or Others if the user specified a distinct unknown category!
  return {
    resolved: false,
    isAmbiguous: false,
    confidence: 0,
    candidates: userCategories.map((c) => c.name),
    reason: `Could not reliably find a category matching "${inputPhrase}". Please select from your categories.`,
  };
}

/**
 * High-level helper: Fetches user categories from DB and resolves phrase.
 * @param {string} userId 
 * @param {string} phrase 
 * @param {string} fullMessage 
 */
async function resolveUserCategory(userId, phrase, fullMessage) {
  let categories = await Category.find({ userId });
  if (!categories || categories.length === 0) {
    // Seed defaults if none exist
    const defaults = [
      { name: 'Food & Dining', limit: 8000, color: '#A78BFA', icon: 'fast-food-outline' },
      { name: 'Shopping', limit: 5000, color: '#84CC16', icon: 'cart-outline' },
      { name: 'Travel & Commute', limit: 4000, color: '#38BDF8', icon: 'car-outline' },
      { name: 'Bills & Utilities', limit: 6000, color: '#F59E0B', icon: 'flash-outline' },
      { name: 'Entertainment', limit: 3000, color: '#F472B6', icon: 'film-outline' },
      { name: 'Others', limit: 3000, color: '#9CA3AF', icon: 'ellipsis-horizontal-outline' },
    ];
    categories = await Category.insertMany(defaults.map((d) => ({ ...d, userId, isDefault: true })));
  }

  return resolveCategoryFromList(phrase, fullMessage, categories);
}

module.exports = {
  ARCHETYPE_ALIASES,
  normalizeString,
  resolveCategoryFromList,
  resolveUserCategory,
};
