// Renders GitHub contribution statistics as a terminal-style SVG on stdout.
// Private contributions are included as counts, the way GitHub shows them on the profile.
// Usage: GITHUB_TOKEN=... GITHUB_USER=hradecek node scripts/stats.mjs > stats.svg

const token = process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_USER ?? "hradecek";
if (!token) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

const YEARS_SHOWN = 5;
const WIDTH = 900;

async function graphql(query) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": `${login}-profile-stats`,
    },
    body: JSON.stringify({ query }),
  });
  const json = await response.json();
  if (!response.ok || json.errors) {
    throw new Error(`GraphQL failed: ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.data;
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

async function fetchStats() {
  const now = new Date();
  const yearFrom = new Date(now);
  yearFrom.setUTCFullYear(now.getUTCFullYear() - 1);
  yearFrom.setUTCHours(0, 0, 0, 0);

  const firstYear = now.getUTCFullYear() - YEARS_SHOWN + 1;
  const yearFields = [];
  for (let year = firstYear; year <= now.getUTCFullYear(); year++) {
    const to = year === now.getUTCFullYear() ? now.toISOString() : `${year}-12-31T23:59:59Z`;
    yearFields.push(`y${year}: contributionsCollection(from: "${year}-01-01T00:00:00Z", to: "${to}") { contributionCalendar { totalContributions } }`);
  }

  const data = await graphql(`{
    user(login: "${login}") {
      last: contributionsCollection(from: "${yearFrom.toISOString()}", to: "${now.toISOString()}") {
        restrictedContributionsCount
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount weekday } }
        }
      }
      ${yearFields.join("\n")}
    }
  }`);

  const user = data.user;
  const days = user.last.contributionCalendar.weeks.flatMap((week) => week.contributionDays);
  const busiest = days.reduce((best, day) => (day.contributionCount > best.contributionCount ? day : best), days[0]);
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
    label: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][weekday],
    count: days.filter((day) => day.weekday === weekday).reduce((sum, day) => sum + day.contributionCount, 0),
  }));
  const years = [];
  for (let year = firstYear; year <= now.getUTCFullYear(); year++) {
    years.push({ year, count: user[`y${year}`].contributionCalendar.totalContributions });
  }

  return {
    updated: isoDay(now),
    total: user.last.contributionCalendar.totalContributions,
    restricted: user.last.restrictedContributionsCount,
    activeDays: days.filter((day) => day.contributionCount > 0).length,
    busiest,
    weekdays,
    years,
  };
}

const fmt = (n) => n.toLocaleString("en-US");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function render(stats) {
  const left = 32;
  const labelWidth = 190;
  const lines = [];
  let y = 84;

  const text = (x, yy, cls, content) => lines.push(`<text x="${x}" y="${yy}" class="${cls}">${esc(content)}</text>`);
  const rect = (x, yy, w, h, fill) => lines.push(`<rect x="${x}" y="${yy}" width="${w}" height="${h}" rx="2" fill="${fill}"/>`);

  text(left, y, "prompt", "$");
  text(left + 24, y, "cmd", 'git shortlog --since="1 year ago"');

  y += 40;
  text(left, y, "dim", "contributions");
  text(left + labelWidth, y, "out", fmt(stats.total));
  text(left + labelWidth + 90, y, "dim", `${stats.activeDays} active days · ${fmt(stats.restricted)} in private repos`);

  y += 30;
  text(left, y, "dim", "busiest day");
  text(left + labelWidth, y, "out", stats.busiest.date);
  text(left + labelWidth + 140, y, "dim", `${stats.busiest.contributionCount} contributions`);

  y += 44;
  text(left, y, "dim", "per year");
  const barLeft = left + labelWidth + 60;
  const barMax = WIDTH - barLeft - 110;
  const yearMax = Math.max(...stats.years.map((item) => item.count), 1);
  for (const item of stats.years) {
    const width = Math.max(Math.round((item.count / yearMax) * barMax), item.count > 0 ? 3 : 0);
    text(left + labelWidth, y, "out", String(item.year));
    rect(barLeft, y - 15, width, 18, "#3fb950");
    text(barLeft + width + 12, y, "dim", fmt(item.count));
    y += 26;
  }

  y += 18;
  text(left, y + 60, "dim", "weekdays");
  const colWidth = 70;
  const colMax = 60;
  const weekdayMax = Math.max(...stats.weekdays.map((item) => item.count), 1);
  stats.weekdays.forEach((item, index) => {
    const x = left + labelWidth + index * colWidth;
    const height = Math.max(Math.round((item.count / weekdayMax) * colMax), item.count > 0 ? 3 : 0);
    text(x, y - 2, "tiny", fmt(item.count));
    rect(x, y + colMax - height + 4, 44, height, "#3fb950");
    text(x, y + colMax + 26, "dim", item.label);
  });
  y += colMax + 26;

  y += 44;
  text(left, y, "prompt", "$");
  lines.push(`<rect x="${left + 24}" y="${y - 16}" width="11" height="20" fill="#e6edf3"><animate attributeName="opacity" values="1;1;0;0" dur="1.1s" repeatCount="indefinite"/></rect>`);

  const height = y + 30;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" role="img" aria-label="GitHub contributions of ${esc(login)}: ${fmt(stats.total)} in the last year, ${stats.activeDays} active days">
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
    .title { fill: #8b949e; font-size: 13px; }
    .prompt { fill: #3fb950; font-size: 20px; }
    .cmd { fill: #e6edf3; font-size: 20px; }
    .out { fill: #e6edf3; font-size: 18px; }
    .dim { fill: #8b949e; font-size: 18px; }
    .tiny { fill: #8b949e; font-size: 12px; }
  </style>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="12" fill="#0d1117" stroke="#30363d"/>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="36" rx="12" fill="#161b22"/>
  <rect x="0.5" y="24" width="${WIDTH - 1}" height="13" fill="#161b22"/>
  <line x1="0.5" y1="36.5" x2="${WIDTH - 0.5}" y2="36.5" stroke="#30363d"/>
  <circle cx="20" cy="18.5" r="6" fill="#ff5f56"/>
  <circle cx="40" cy="18.5" r="6" fill="#ffbd2e"/>
  <circle cx="60" cy="18.5" r="6" fill="#27c93f"/>
  <text x="${WIDTH / 2}" y="23" text-anchor="middle" class="title">ivo@brno: ~</text>
  <text x="${WIDTH - 20}" y="23" text-anchor="end" class="title">updated ${stats.updated}</text>
  ${lines.join("\n  ")}
</svg>
`;
}

process.stdout.write(render(await fetchStats()));
