# The Investor Panel

A free website. Meet the Panel (`index.html`) is the home page.

- **Score a Stock** (`score.html`): eight famous investors score any U.S. company. Listed companies load instantly; anything else works by dropping in its SEC data file.
- **Meet the Panel** (`index.html`): each investor's story and every metric on his checklist explained for students.
- **Indices** (`indices.html`): the S&P 500, Nasdaq-100 and Dow Jones each scored as if they were one company, with every holding counted by its weight in the index.
- **Rank Stocks** (`rank.html`): every U.S.-listed company with SEC filings, ranked by each investor's rules, with filters for index, sector and size.
- **Trends** (`trends.html`): charts of each investor's numbers for a company over the years, next to its sector.

Every company is compared with its sector, built from the S&P 500 companies in that sector and weighted by market value, the way sector funds like XLK are built.

**Investor photos:** add a photo you have permission to use as `assets/img/graham.jpg`, `buffett.jpg`, `lynch.jpg`, `fisher.jpg`, `greenblatt.jpg`, `piotroski.jpg`, `slegers.jpg` or `neff.jpg`. Until then, the site shows initials.

No AI and no paid data are involved.

## How the data stays fresh

The workflow in `.github/workflows/update-and-publish.yml` runs every weekday evening and runs `scripts/build.mjs`, which:

1. Downloads the SEC's bulk file of every company's financial data once a week and keeps it in GitHub's cache between runs.
2. Gets every U.S.-listed stock's price and sector from Nasdaq's stock screener, daily, and monthly price history for index companies from Yahoo Finance, weekly.
3. Gets the three indexes' member lists from Wikipedia.
4. Scores everything and publishes the site.

The data is built fresh each run and published with the site, so it is not stored in the repository.

To change the Treasury yield and CPI used for the rankings, edit `data/settings.json`.

To force a fresh SEC download, go to **Actions → Update data and publish → Run workflow** and check the box.
