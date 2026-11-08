const { SKIN_TYPES, WEATHER } = require('./skin-profile');

const STEPS = ['Face wash', 'Serum', 'Moisturizer', 'Sunscreen'];
const MATCHES = {
  Sensitive: {
    redness: ['Mild fragrance-free, soap-free cleanser', 'Panthenol serum', 'Fragrance-free ceramide and panthenol moisturizer', 'Fragrance-free zinc oxide SPF 50'],
    dehydration: ['Cream-based hydrating cleanser', 'Hyaluronic acid and panthenol serum', 'Ceramide and squalane moisturizer', 'Fragrance-free moisturizing SPF 50'],
    shine: ['Gentle fragrance-free gel cleanser', 'Panthenol serum', 'Lightweight fragrance-free ceramide lotion', 'Lightweight fragrance-free mineral SPF 50']
  },
  Oily: {
    redness: ['Gentle fragrance-free gel cleanser', 'Panthenol serum', 'Lightweight non-comedogenic ceramide lotion', 'Lightweight fragrance-free mineral SPF 50'],
    dehydration: ['Gentle hydrating gel cleanser', 'Hyaluronic acid and niacinamide serum', 'Lightweight non-comedogenic ceramide gel-cream', 'Hydrating, non-greasy broad-spectrum SPF 50'],
    shine: ['Gentle foaming cleanser', 'Niacinamide 4–5% or zinc PCA serum', 'Oil-free non-comedogenic gel moisturizer', 'Matte-finish broad-spectrum SPF 50']
  },
  Dry: {
    redness: ['Fragrance-free cream cleanser', 'Panthenol serum', 'Ceramide and squalane cream', 'Moisturizing mineral SPF 50'],
    dehydration: ['Non-foaming cream cleanser', 'Hyaluronic acid and panthenol serum', 'Cream with ceramides, cholesterol and fatty acids', 'Moisturizing broad-spectrum SPF 50'],
    shine: ['Non-stripping cream cleanser', 'Optional panthenol serum', 'Ceramide lotion with a light finish', 'Non-greasy moisturizing broad-spectrum SPF 50']
  },
  Normal: {
    redness: ['Gentle fragrance-free cleanser', 'Panthenol serum', 'Lightweight ceramide and panthenol lotion', 'Fragrance-free mineral SPF 50'],
    dehydration: ['Mild hydrating cleanser', 'Hyaluronic acid and glycerin serum', 'Ceramide moisturizer with glycerin', 'Hydrating broad-spectrum SPF 50'],
    shine: ['Gentle gel cleanser', 'Niacinamide 4% serum', 'Lightweight non-comedogenic lotion', 'Lightweight broad-spectrum SPF 50']
  },
  Combination: {
    redness: ['Gentle fragrance-free cleanser', 'Panthenol serum', 'Ceramide and panthenol gel-cream', 'Fragrance-free mineral SPF 50'],
    dehydration: ['Hydrating gel cleanser', 'Hyaluronic acid and glycerin serum', 'Lightweight ceramide gel-cream', 'Hydrating, non-greasy broad-spectrum SPF 50'],
    shine: ['Gentle gel cleanser', 'Niacinamide 4–5% or zinc PCA serum', 'Lightweight gel moisturizer with extra lotion on dry areas if needed', 'Lightweight broad-spectrum SPF 50']
  }
};
const SIGNALS = [
  { key:'redness', label:'Higher visible redness', metric:'redness', test:value => value >= 55 },
  { key:'dehydration', label:'Lower hydration estimate', metric:'hydration', test:value => value < 50 },
  { key:'shine', label:'Higher visible shine', metric:'oilLevel', test:value => value >= 55 }
];
const validScore = value => Number.isFinite(value) && value >= 0 && value <= 100;

function recommendRoutine(profile, scan) {
  const { skinType, weather, age, shavesFace } = profile;
  if (!SKIN_TYPES.includes(skinType)) return { state:'needs_profile', products:[] };
  if (!scan || !SIGNALS.every(({metric}) => validScore(scan[metric]))) {
    return { state:'needs_scan', products:[] };
  }
  const cues = SIGNALS.filter(signal => signal.test(scan[signal.metric]));
  const focus = cues.find(signal => MATCHES[skinType][signal.key]);
  if (!focus) return { state:'no_match', products:[] };

  const products = [...MATCHES[skinType][focus.key]];
  if (focus.key === 'shine' && skinType !== 'Dry' && ['humid', 'sunny'].includes(weather)) {
    products[2] += ' · use a thin layer in hot weather';
  }
  if (focus.key === 'dehydration' && ['cold', 'dry'].includes(weather)) {
    products[2] += ' · use a richer texture where skin feels tight';
  }
  const weatherNote = ['humid', 'sunny'].includes(weather)
    ? 'For outdoor use, choose a water-resistant sunscreen and follow the reapplication directions on its label.'
    : ['cold', 'dry'].includes(weather)
      ? 'Apply moisturizer after washing and add a richer layer where skin feels tight.'
      : 'Keep your routine consistent and adjust texture if skin feels tight or shiny.';
  return {
    state:'matched',
    skinType,
    weather: WEATHER[weather] || WEATHER.mild,
    focus: focus.label,
    scanCues: cues.map(({label, metric}) => ({ label, value:scan[metric] })),
    products: products.map((product, index) => ({step:STEPS[index], product}))
      .filter(({step}) => step !== 'Serum' || age >= 18),
    weatherNote,
    ageNote: age >= 18
      ? 'Introduce one product at a time and test it on a small area first.'
      : 'Start with the basic steps. Ask a parent or dermatologist before adding a targeted active.',
    groomingNote: shavesFace ? 'Use a gentle moisturizer after shaving and pause strong actives if skin feels irritated.' : null,
    habits: ['Use shade and protective clothing outdoors.', 'Wash gently with lukewarm water and pat your face dry.']
  };
}

module.exports = { recommendRoutine };
