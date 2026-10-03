// Minimal hosted checkout page of the MOCK payment provider (test environments only).

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderMockCheckout(c: {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
  billingInterval: string;
  status: string;
}): string {
  const price = `${(c.priceMinor / 100).toFixed(2)} ${c.currency} / ${c.billingInterval.toLowerCase()}`;
  const open = c.status === 'OPEN';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mock checkout · TrainMe</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0}
  .card{background:#1e293b;border-radius:16px;padding:32px;width:min(380px,90vw);box-shadow:0 20px 50px #0008}
  .tag{display:inline-block;background:#f59e0b22;color:#fbbf24;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600}
  h1{font-size:22px;margin:12px 0 4px} .price{font-size:28px;font-weight:700;margin:16px 0}
  button{width:100%;padding:12px;border:0;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;margin-top:8px}
  .pay{background:linear-gradient(90deg,#5b5bf7,#22d3ee);color:#fff}.cancel{background:#334155;color:#e2e8f0}
  p.small{font-size:12px;color:#94a3b8}
</style></head><body><div class="card">
<span class="tag">TEST MODE · MOCK PROVIDER</span>
<h1>TrainMe ${esc(c.name)}</h1>
<div class="price">${esc(price)}</div>
${open ? `<button class="pay" onclick="go('pay')">Pay (simulated)</button><button class="cancel" onclick="go('cancel')">Cancel</button>` : `<p>This checkout is ${esc(c.status.toLowerCase())}.</p>`}
<p class="small">No money moves. "Pay" sends a signed webhook exactly like a real provider would.</p>
</div><script>
async function go(outcome){
  const r = await fetch(location.pathname, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({outcome})});
  const d = await r.json();
  if (d.returnUrl) location.href = d.returnUrl; else alert(d.detail || 'Payment failed');
}
</script></body></html>`;
}
