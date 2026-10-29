# Shade Protocol website

Static marketing site for Shade Protocol. GitHub Actions publishes this folder to GitHub Pages on every push to `main` (see `.github/workflows/pages.yml`). You can also run that workflow by hand with **Actions → Deploy website to GitHub Pages → Run workflow**.

## Custom domain

1. Rename `CNAME.example` to `CNAME`. The file should contain only the real domain, one line, with no scheme or path. The placeholder is `shadeprotocol.xyz`; change that line if the domain is different, then commit and push to `main`.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. At the DNS host for the domain, add these records (GitHub Pages anycast addresses):

   Apex (`shadeprotocol.xyz`, or your domain):

   | Type | Name | Value |
   | --- | --- | --- |
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | AAAA | `@` | `2606:50c0:8000::153` |
   | AAAA | `@` | `2606:50c0:8001::153` |
   | AAAA | `@` | `2606:50c0:8002::153` |
   | AAAA | `@` | `2606:50c0:8003::153` |

   `www`:

   | Type | Name | Value |
   | --- | --- | --- |
   | CNAME | `www` | `chenz0-13.github.io` |

   Remove any conflicting A, AAAA, or CNAME records on those names (including a parking-page record).

4. After the Pages deployment is green and DNS has propagated, return to **Settings → Pages** and enable **Enforce HTTPS**. Certificate issuance can take a while after the domain first resolves to GitHub.

Until `CNAME` exists, the site is served at `https://chenz0-13.github.io/shade-protocol/`.
