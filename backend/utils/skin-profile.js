const CONCERNS = {
  acne: 'Acne-prone skin',
  redness: 'Redness',
  dryness: 'Dryness',
  spots: 'Dark spots or acne marks',
  oil: 'Large pores or excess oil',
  dehydration: 'Dehydration',
  dullness: 'Dullness',
  flaking: 'Flaky skin',
  uneven: 'Uneven skin tone'
};
const WEATHER = {
  mild: 'Mild',
  humid: 'Hot and humid',
  sunny: 'Hot and sunny',
  dry: 'Dry and windy',
  cold: 'Cold and dry'
};
const SKIN_TYPES = ['Sensitive', 'Oily', 'Dry', 'Normal', 'Combination'];
const UNKNOWN_SKIN = 'Not sure yet';
const GENDERS = ['Woman', 'Man', 'Non-binary', 'Self-described', 'Prefer not to say'];
const REMINDER_SLOTS = ['morning', 'evening'];
const TIME_FORMAT = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

module.exports = { CONCERNS, WEATHER, SKIN_TYPES, UNKNOWN_SKIN, GENDERS, REMINDER_SLOTS, TIME_FORMAT };
