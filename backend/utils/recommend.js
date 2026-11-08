function toneFromITA(ita) {
  if (ita > 55) return 'Very light';
  if (ita > 41) return 'Light';
  if (ita > 28) return 'Intermediate';
  if (ita > 10) return 'Tan';
  if (ita > -30) return 'Brown';
  return 'Dark';
}

module.exports = { toneFromITA };
