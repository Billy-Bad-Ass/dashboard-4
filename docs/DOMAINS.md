# Domains

`bbanetwork.org` is registered with Cloudflare, on the same account as the
Workers plan. This is what to do with it — and one thing not to.

## The plan

| Host | Points at | Why |
| --- | --- | --- |
| `bbanetwork.org` | Project 2, the store | The thing customers buy from. The brand name at the apex is the trust signal, and a bare domain is what people type. |
| `heartbeat.bbanetwork.org` | Project 4, this dashboard | Internal. Behind Cloudflare Access. |
| `www.bbanetwork.org` | redirect to apex | Cloudflare does this with a bulk redirect for free. Pick one canonical host or split your search authority in half. |

Nothing is pointed automatically. Attaching a domain is four taps in the
Cloudflare dashboard — see below.

## The subdomain split

Each business gets its own subdomain, with the apex as a hub that points at
them. Project 6 owns the public face; the businesses keep their own repos.

| Host | What | Owned by |
| --- | --- | --- |
| `bbanetwork.org` | Brand hub — what BBA Network is, and links out | Project 6 |
| `audit.bbanetwork.org` | Website Health Check, $100 | Project 1 |
| `guides.bbanetwork.org` | The printable guides storefront | Project 2 |
| `heartbeat.bbanetwork.org` | This dashboard, behind Access | Project 4 |

### This replaces an earlier warning, and why

An earlier version of this document said **"do not put Project 1 on this
domain"**, because Project 1 was pSEO Forge — a programmatic-SEO affiliate
engine generating hundreds of pages, with real scaled-content-policy risk. The
argument was that you should not take that bet with the domain your storefront
sells from.

**Project 1 has since pivoted.** It now sells a hand-delivered website audit at
$100 through Stripe, and the pSEO engine sits unmonetised in the same
repository. A human writing one report per customer carries none of the risk
that warning was about, so the warning is withdrawn and `audit.` is correct.

If the pSEO engine is ever switched on and pointed at this domain, the original
argument comes back in full. It is dormant, not wrong.

### The store moving off the apex

Earlier guidance put the storefront at the apex on trust grounds — a bare brand
domain is what people type. With more than one business under the brand, a hub
that routes to them is the better structure, and the trust argument transfers to
the hub.

No redirect is needed. Nothing here has accumulated any search authority yet, so
there is nothing to preserve — a 301 would be protecting a number that is
currently zero.

## Email

Cloudflare Email Routing is free and forwards to an existing inbox. It gives you
addresses at the domain without running a mailbox.

**Cloudflare → your domain → Email → Email Routing → Get started.** Add a
destination address (`bbacentralworkspace@gmail.com`), verify it from that
inbox, and create routes:

| Address | Forwards to | For |
| --- | --- | --- |
| `support@bbanetwork.org` | bbacentralworkspace@gmail.com | Buyers with download problems |
| `hello@bbanetwork.org` | bbacentralworkspace@gmail.com | Everything else |

Cloudflare adds the MX and SPF records itself. It only *receives* — sending as
`support@bbanetwork.org` needs a real mail provider, and Gmail's "send as" over
SMTP is the cheap way to do that later.

### There is a live bug here

Project 2's `catalog/products.json` sets:

```json
"supportEmail": "support@bba.network"
```

That is **`bba.network`** — a different domain from `bbanetwork.org`. Unless you
also own it, every support email from a paying customer goes nowhere, silently.
On a storefront whose delivery is a signed download link, the support address is
the only channel a buyer has when something fails.

Fix it in Project 2 to `support@bbanetwork.org` once Email Routing is set up.

Project 1 has the same shape of problem in `config/site.config.ts`, though it is
still on placeholder defaults (`https://example.com`, `hello@example.com`) —
harmless while nothing is deployed, wrong the moment it is.

## Attaching a domain to a Worker

Four taps, in the browser. No token permissions and no config change — which
matters, because a `routes` entry in `wrangler.jsonc` makes the deploy itself
responsible for creating DNS records, and the deploy token does not have that
permission. Doing it in the dashboard keeps the deploy from breaking.

1. Cloudflare → **Workers & Pages** → **bba-heartbeat**
2. **Settings** → **Domains & Routes** → **Add** → **Custom domain**
3. Enter `heartbeat.bbanetwork.org`
4. **Add domain**

Cloudflare creates the DNS record and issues the certificate. It works within a
minute or two; the certificate can take longer to go fully green.

The `workers.dev` URL keeps working afterwards. If you want it off — worth doing
once the custom domain is live, so there is one address to protect rather than
two — set `workers_dev: false` in `wrangler.jsonc` and redeploy.

### Then update Cloudflare Access

If Access is already protecting the `workers.dev` hostname, it is **not**
protecting the new one. An Access application matches a hostname, so a new
hostname is an unprotected door to the same Worker.

Cloudflare → Zero Trust → Access → Applications → your app → add the new
hostname, or create a second application for it.

## After pointing anything

Update `NEXT_PUBLIC_SITE_URL` in `wrangler.jsonc` and the `DASHBOARD_URL`
repository secret, so the agents report to the right place and any absolute
links are right.
