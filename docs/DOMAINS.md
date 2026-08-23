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

## Do not put Project 1 on this domain

Project 1 is a programmatic-SEO affiliate engine: a few hundred to a few
thousand generated pages targeting search. Its own README is blunt that whether
it earns anything "depends on niche choice, patience, and staying on the right
side of search engines' scaled-content policies."

That is a bet worth taking. It is not a bet worth taking **with the domain your
storefront sells from.**

- Google's scaled-content-abuse policy applies to exactly this pattern. If it
  goes wrong, it goes wrong as a manual action or an algorithmic suppression.
- A subdomain is not a firewall. Google treats subdomains as part of the same
  site when it suits them to, and reputational signals bleed both ways.
- Affiliate SEO ranks better on a niche-branded domain anyway. A page about game
  prices does better at a domain that is about game prices than at
  `bbanetwork.org/best/...`, because the domain itself is a relevance signal.

**Recommendation:** buy Project 1 its own cheap domain matched to whichever
niche it ships with. Around $10–15/year, and it keeps `bbanetwork.org` clean if
the experiment goes badly. Record it in the ledger against `project-1` so its
ROI carries its own cost.

If you decide to use a subdomain anyway, that is a legitimate call — put it on
`deals.bbanetwork.org` rather than a path, and know what you are accepting.

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
