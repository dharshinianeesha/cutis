// Groups saved scans by local day and summarises the trend.
function dayKey(date, tzOffsetMin) {
  const local = new Date(new Date(date).getTime() - tzOffsetMin * 60000); // getTimezoneOffset() = UTC - local
  return local.toISOString().slice(0, 10);
}
const avg = a => Math.round(a.reduce((s, x) => s + x, 0) / a.length);

function summarize(scans, tzOffsetMin = 0) {
  const by = new Map();
  for (const s of scans) {
    const k = dayKey(s.createdAt, tzOffsetMin);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(s);
  }
  const days = [...by.keys()].sort().map(date => {
    const g = by.get(date);
    return { date, count: g.length, hydration: avg(g.map(x => x.hydration)), oil: avg(g.map(x => x.oilLevel)), redness: avg(g.map(x => x.redness)) };
  });
  const summary = { scans: scans.length, daysTracked: days.length, insight: 'Scan on a few different days to see your trend.' };
  if (days.length >= 2) {
    const f = days[0], l = days[days.length - 1];
    const change = { hydration: l.hydration - f.hydration, oil: l.oil - f.oil, redness: l.redness - f.redness };
    summary.change = change;
    const bits = [];
    if (Math.abs(change.hydration) >= 5) bits.push(`hydration ${change.hydration > 0 ? 'rose' : 'fell'} ${Math.abs(change.hydration)} points`);
    if (Math.abs(change.oil) >= 5) bits.push(`oil level ${change.oil > 0 ? 'rose' : 'fell'} ${Math.abs(change.oil)} points`);
    if (Math.abs(change.redness) >= 5) bits.push(`redness ${change.redness > 0 ? 'rose' : 'fell'} ${Math.abs(change.redness)} points`);
    summary.insight = bits.length ? `Since ${f.date}, ${bits.join(', ')}.` : `Your readings have been steady since ${f.date}.`;
  }
  return { days, summary };
}
module.exports = { summarize, dayKey };
