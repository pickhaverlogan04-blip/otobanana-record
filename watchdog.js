const TOKEN = process.env.GH_PAT || process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;
const API = 'https://api.v2.otobanana.com/api/users/a28c1be1-bb11-43fc-935a-c6c85bbb40e7/livestreams/?is_adult=1';
const SLEEP = 25000;
const MAX_RUN_MS = 5.6 * 3600 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getLive() {
  try {
    const r = await fetch(API, { headers: { Accept: 'application/json' } });
    const j = await r.json();
    return (j.data || []).find((x) => x.is_open) || null;
  } catch (e) {
    console.log('api err', e.message);
    return null;
  }
}

async function dispatch(workflow, inputs) {
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs: inputs || {} }),
  });
  console.log('dispatch', workflow, r.status, JSON.stringify(inputs || {}));
  return r.ok;
}

(async () => {
  const start = Date.now();
  const seen = new Set();
  console.log('watchdog start', new Date().toISOString());
  while (Date.now() - start < MAX_RUN_MS) {
    const live = await getLive();
    if (live) {
      const id = live.post.id;
      const title = live.post.title || '';
      console.log('LIVE', id, title);
      if (!seen.has(id)) {
        seen.add(id);
        await dispatch('record.yml', { live_id: id });
      }
      await sleep(SLEEP);
    } else {
      await sleep(SLEEP);
    }
  }
  console.log('watchdog timeout, chaining next');
  await dispatch('watchdog.yml', {});
})();
